# Welcome to your CDK TypeScript project

This is a blank project for CDK development with TypeScript.

The `cdk.json` file tells the CDK Toolkit how to execute your app.

## Useful commands

* `npm run build`   type-check the project
* `npm run watch`   watch for changes and type-check
* `npm run test`    perform the jest unit tests
* `npx cdk deploy`  deploy this stack to your default AWS account/region
* `npx cdk diff`    compare deployed stack with current state
* `npx cdk synth`   emits the synthesized CloudFormation template

## Gemini analyzer

Install the Google Gen AI SDK used by the analyzer:

```sh
npm install @google/genai
```

Before running `npx cdk deploy`, set `GEMINI_API_KEY` in the shell environment
used for CDK. The stack passes it to the analyze Lambda. This injects the key
into Lambda environment configuration and synthesized deployment artifacts;
for production, prefer loading it from AWS Secrets Manager at runtime instead.
Never put API keys in source code or commit them to the repository. Use the API
URL printed by the deployment as the frontend's `API_BASE`.
