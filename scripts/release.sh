#!/bin/bash

# Release script for homebridge-simplisafe3

# Ensure we are on master
BRANCH=$(git branch | grep \* | cut -d ' ' -f2)
if [ "$BRANCH" != "master" ]; then
    echo "The branch is not master!"
    exit 1
fi

# Ask for version
read -p "Enter the new release version (e.g. 1.0.0): " NEW_VERSION

# Ensure version exists in Changelog
if [ "$(cat CHANGELOG.md | grep -c "v$NEW_VERSION")" = 0 ]; then
    echo "Changelog doesn't contain any information about v$NEW_VERSION!"
    exit 1
fi

# Check version doesn't already exist
if [ "$(git tag | grep -c "v$NEW_VERSION")" = 1 ]; then
    echo "Version v$NEW_VERSION already exists!"
    exit 1
fi

# Set new version
sed -E -i '' "s/\"version\": \"[1-9\.]+\"/\"version\": \"$NEW_VERSION\"/g" package.json

# Build
if ! npm install; then
    echo "An error occurred while installing packages"
    exit 1
fi

if ! npm run build; then
    echo "An error occurred while building"
    exit 1
fi

# Push & deploy
if ! npm run deploy; then
    echo "An error occurred while deploying to npm"
    exit 1
fi

git commit -am "Release v$NEW_VERSION"
git tag "v$NEW_VERSION"
git push origin master

echo "Released v$NEW_VERSION"