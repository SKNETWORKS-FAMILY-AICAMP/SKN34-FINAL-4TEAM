#!/bin/sh
# Disposable container copy avoids slow Windows bind-mount classpath IO.
set -eu
mkdir -p /tmp/initial-build-qa/backend/content-service
tar -C /workspace/backend/content-service --exclude=.gradle --exclude=build -cf - . | tar -C /tmp/initial-build-qa/backend/content-service -xf -
cp /workspace/docs/verification/two-path-qa/qa.init.gradle /tmp/initial-build-qa/qa.init.gradle
cd /tmp/initial-build-qa/backend/content-service
set +e
gradle -I ../../qa.init.gradle "$@" --no-daemon --max-workers=2 -Pkotlin.compiler.execution.strategy=in-process '-Dorg.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=768m'
result=$?
set -e
mkdir -p /workspace/docs/verification/two-path-qa/current-results
for directory in test-results reports qa; do
    if [ -d "build/$directory" ]; then
        cp -R "build/$directory" /workspace/docs/verification/two-path-qa/current-results/
    fi
done
exit "$result"
