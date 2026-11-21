#!/bin/sh
set -eu
for service in core-api content-service; do
 mkdir -p /tmp/initial-build-qa/backend/$service
 tar -C /workspace/backend/$service --exclude=.gradle --exclude=build -cf - . | tar -C /tmp/initial-build-qa/backend/$service -xf -
 cd /tmp/initial-build-qa/backend/$service
 gradle bootJar --no-daemon --max-workers=2 -Pkotlin.compiler.execution.strategy=in-process '-Dorg.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=768m'
done
