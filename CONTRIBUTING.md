# Contributing

Thanks for helping with `elusion-works`.

## Principles

- keep the public boundary strict
- keep the build static-first and dependency-light
- prefer clear editorial quality over noisy automation
- do not commit secrets, machine-local paths, or private workspace notes

## Workflow

1. update or add the relevant source data
2. run the project's build / preview commands as documented in the README
3. verify the public output contains only public-safe data
4. verify the internal runtime still renders manager-only features locally
5. commit only the intended scope

## Pull requests

- explain which audience changed: `public`, `internal`, or `both`
- call out any privacy-boundary changes explicitly
- include the exact verification commands you ran
