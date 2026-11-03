"""Fail closed unless a trusted CI run and its Required CI job passed for the target."""
import json
import os
from pathlib import Path
import re
import urllib.parse
import urllib.request


def require(condition):
    if not condition:
        raise ValueError('Invalid CI evidence')


def api(path):
    repository = urllib.parse.quote(os.environ['GITHUB_REPOSITORY'], safe='/')
    request = urllib.request.Request(
        f"{os.environ['GITHUB_API_URL']}/repos/{repository}{path}",
        headers={
            'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
            'Accept': 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
        },
    )
    with urllib.request.urlopen(request, timeout=10) as response:
        require(response.status == 200)
        data = json.load(response)
    require(isinstance(data, dict))
    return data


def records(path, key, fetch=api):
    page, count = 1, 0
    while True:
        data = fetch(f'{path}{"&" if "?" in path else "?"}per_page=100&page={page}')
        rows, total = data[key], data['total_count']
        require(isinstance(rows, list) and all(isinstance(row, dict) for row in rows))
        require(type(total) is int and total >= 0 and len(rows) <= 100)
        count += len(rows)
        require(count <= total and (count == total or len(rows) == 100))
        yield from rows
        if count == total:
            return
        page += 1


def valid_run(run, workflow_id, branch, sha, repository=None):
    repository = repository or os.environ['GITHUB_REPOSITORY']
    return (
        type(run['id']) is int and run['id'] > 0
        and type(run['run_attempt']) is int and run['run_attempt'] > 0
        and run['workflow_id'] == workflow_id
        and run['path'] == '.github/workflows/ci.yml' and run['name'] == 'CI'
        and run['status'] == 'completed' and run['conclusion'] == 'success'
        and run['event'] in {'push', 'workflow_dispatch'}
        and run['head_branch'] == branch and run['head_sha'] == sha
        and run['repository']['full_name'] == repository
        and run['head_repository']['full_name'] == repository
    )


def verify_ci(branch, sha, run_id, attempt, repository=None, fetch=api):
    """Shared by Images and Deploy, including its final server-side recheck."""
    require(branch in {'develop', 'main'} and re.fullmatch('[0-9a-f]{40}', sha))
    require(type(run_id) is int and run_id > 0 and type(attempt) is int and attempt > 0)
    workflow = fetch('/actions/workflows/ci.yml')
    require(type(workflow['id']) is int and workflow['id'] > 0)
    require(workflow['path'] == '.github/workflows/ci.yml' and workflow['name'] == 'CI' and workflow['state'] == 'active')
    head = fetch('/git/ref/heads/' + branch)
    require(head['ref'] == 'refs/heads/' + branch and head['object']['sha'] == sha)
    run = fetch(f'/actions/runs/{run_id}')
    require(valid_run(run, workflow['id'], branch, sha, repository))
    require(run['id'] == run_id and run['run_attempt'] == attempt)
    jobs = records(f'/actions/runs/{run_id}/attempts/{attempt}/jobs', 'jobs', fetch)
    required = [job for job in jobs if job['name'] == 'Required CI']
    require(len(required) == 1)
    job = required[0]
    require(job['status'] == 'completed' and job['conclusion'] == 'success')
    require(job['run_id'] == run_id and job['head_sha'] == sha)
    # The attempt-specific endpoint also binds responses that omit optional run_attempt.
    require(job.get('run_attempt', attempt) == attempt)
    return run


def main():
    event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
    event_name = os.environ['GITHUB_EVENT_NAME']
    if event_name == 'workflow_run':
        candidate = event['workflow_run']
        branch, sha = candidate['head_branch'], candidate['head_sha']
    elif event_name == 'workflow_dispatch':
        ref = os.environ['GITHUB_REF']
        require(ref in {'refs/heads/develop', 'refs/heads/main'})
        branch, sha = ref.removeprefix('refs/heads/'), os.environ['GITHUB_SHA']
    else:
        raise ValueError('Unsupported trigger')
    require(branch in {'develop', 'main'} and re.fullmatch('[0-9a-f]{40}', sha))

    if event_name == 'workflow_dispatch':
        query = urllib.parse.urlencode({'branch': branch, 'head_sha': sha, 'status': 'success'})
        candidates = records('/actions/workflows/ci.yml/runs?' + query, 'workflow_runs')
        candidate = next((run for run in candidates if valid_run(run, run['workflow_id'], branch, sha)), None)
        require(candidate is not None)
    run = verify_ci(branch, sha, candidate['id'], candidate['run_attempt'])
    require(valid_run(candidate, run['workflow_id'], branch, sha))
    images_run_id, images_attempt = int(os.environ['GITHUB_RUN_ID']), int(os.environ['GITHUB_RUN_ATTEMPT'])
    require(images_run_id > 0 and images_attempt > 0)
    source = {'repository': os.environ['GITHUB_REPOSITORY'], 'sha': sha, 'branch': branch,
              'ci_run_id': run['id'], 'ci_run_attempt': run['run_attempt'],
              'images_run_id': images_run_id, 'images_run_attempt': images_attempt}
    Path(os.environ['PUBLICATION_SOURCE_PATH']).write_text(json.dumps(source))
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
        output.write(f'sha={sha}\nbranch={branch}\n')
    print(f"Validated CI run {run['id']}, attempt {run['run_attempt']} for {branch}@{sha}")


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, TypeError):
        raise SystemExit('Required CI evidence validation failed; publishing stopped')
