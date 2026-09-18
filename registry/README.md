# QubitOS app registry

`index.json` lists packages that QubitOS (the React Native app) can install over the internet with `qpm install <name>` or from the App Store window.

Package kinds:

- `script`: `.qsh` scripts, circuit JSON and QBNN weights written under `/apps/<name>/` in QubitFS, plus a `main` script. Installed as `/bin/app:<name>` and a dock app that runs the script.
- `web`: a URL opened in the Browser app (a web app).

Publish your own package by hosting a manifest JSON anywhere and running `qpm install https://…/your-package.json`. Script packages may only write under `/apps/`.
