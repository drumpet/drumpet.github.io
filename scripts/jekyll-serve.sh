#!/bin/sh
# http://localhost:4000 에서 미리보기. Ctrl+C로 종료.
set -e
cd "$(dirname "$0")/.."
docker run --rm -it -v "$PWD":/site -w /site -e BUNDLE_PATH=/site/vendor/bundle -p 4000:4000 \
  ruby:3.3 sh -c "bundle install --quiet && bundle exec jekyll serve --host 0.0.0.0 --livereload"
