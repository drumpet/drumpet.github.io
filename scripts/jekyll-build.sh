#!/bin/sh
# GitHub Pages와 같은 github-pages gem으로 Docker 안에서 빌드한다. 결과는 _site/.
set -e
cd "$(dirname "$0")/.."
docker run --rm -v "$PWD":/site -w /site -e BUNDLE_PATH=/site/vendor/bundle \
  ruby:3.3 sh -c "bundle install --quiet && bundle exec jekyll build --quiet"
echo "built: _site/"
