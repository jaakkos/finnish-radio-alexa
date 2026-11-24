# Finnish Radio for Alexa

A private Alexa-hosted skill that plays eight Yle radio streams directly on an Echo. Say **“Alexa, open Finnish radio”** to start Yle Radio Suomi.

The owner reported that the installed skill works. This repository includes the radio handler, station catalog, interaction model, local tests, and a GitHub Actions test workflow.

## Repository status

This prepared repository has a local Git history on `master`. It has **no configured remote**, and has not been pushed to GitHub or connected to the Amazon account from the preparation environment.

The working skill already has an Amazon-managed Git repository. Use the one-time instructions below to obtain that repository and its deployment configuration, then copy this project's files into that checkout. This preserves the existing skill ID and its Git history.

The included archive retains `.git`. If your extraction tool removes it, run `git init -b master`, `git add .`, and `git commit -m "Prepare Finnish Radio repository"` inside the extracted folder before following the copy command below.

## One-time connection to the existing skill

These commands are for a macOS or Linux terminal with Git, Node.js, and npm installed. Node 24 is configured for local tests; the hosted handler retains its existing Node 16-compatible syntax.

### 1. Authenticate and clone the Alexa repository

From the folder containing this extracted `finnish-radio-alexa` folder, run:

```bash
npm install -g ask-cli
ask configure
ask init --hosted-skill-id amzn1.ask.skill.1d225c7b-7836-42dd-9002-a760709170e7
```

Sign in with the Amazon developer account that owns the working skill. An AWS account/profile is not needed for Alexa-hosted skills. When `ask init` asks for a project directory, choose **`finnish-radio-connected`**, so the new checkout is alongside this prepared repository.

The ASK CLI sets up the Amazon `origin` remote, authentication helper, deployment hook, local ASK files, and exported skill package. Keep those generated files.

### 2. Add the prepared source and development tools

```bash
cd finnish-radio-connected
git switch master
git status --short
```

A fresh ASK clone can show generated `skill-package` files and `.gitignore` changes; those are expected and will be included in the first commit below. Commit or stash any unrelated edits before continuing. The command below exports only the prepared repository's tracked files; it does not copy `.git` or replace Alexa's generated configuration or `skill-package/skill.json` manifest.

```bash
git -C ../finnish-radio-alexa archive --format=tar HEAD | tar -xf -
npm test
git diff --stat
git diff -- lambda skill-package
```

Review the application and model differences before committing. This project contains the source prepared for the original installation. If you made newer changes in the console, incorporate those changes here rather than replacing them with an older version. Confirm any recent console model/manifest changes are reflected in the exported `skill-package` too.

Once the files are as intended:

```bash
git add README.md package.json .gitignore .gitattributes .editorconfig .nvmrc .github lambda tests skill-package
git commit -m "Add Finnish Radio source and development workflow"
```

The `finnish-radio-connected` checkout is now the folder to use for future development. The original prepared folder is no longer needed for normal updates.

### 3. Add a private GitHub repository

Create an **empty private** repository named `finnish-radio-alexa` under `jaakkos` at [GitHub's new repository page](https://github.com/new). Leave its initialization options empty so it has no competing initial commit.

Keep Amazon's remote named `origin`; add GitHub as `github`:

```bash
git remote add github git@github.com:jaakkos/finnish-radio-alexa.git
git push github master
```

This SSH URL assumes that GitHub SSH authentication is configured on your computer. You can use the HTTPS clone URL shown by GitHub if you prefer HTTPS authentication. Keep the branch's existing Alexa upstream; there is no need for `-u` on the GitHub push.

The ASK pre-push hook also needs a working ASK login when you push to a secondary remote. If authentication expires, run `ask configure` again with the same profile.

### 4. Deploy to the existing Echo skill

After reviewing and committing the changes:

```bash
git push origin master
```

Pushing to Amazon's `master` branch deploys the development skill's backend and skill package. Check the deployment result in the Alexa Developer Console, keep **Test → Development** enabled, and try the skill on the Echo.

## Normal update workflow

Run these commands from `finnish-radio-connected`. Work on `master`, or merge a reviewed feature branch into `master` first.

```bash
git switch master
git pull --ff-only origin master
# Edit the files, then:
npm test
git add <changed-files>
git commit -m "Update Finnish Radio"
git push github master
git push origin master
```

Replace `<changed-files>` with the actual paths you changed; it is a placeholder, not a command to paste literally. The GitHub push saves the revision and runs tests. The Amazon push deploys it. These commands do not wait for GitHub CI; `npm test` is the local check before deployment.

If you made changes through GitHub's website or merged a GitHub pull request, fetch and integrate that branch before your next update:

```bash
git fetch github
git merge --ff-only github/master
npm test
git push origin master
```

If a fast-forward fails, inspect the differing commits and resolve the history normally. Avoid force-pushing over Amazon's existing history.

### Files to edit

| Change | File |
| --- | --- |
| Stream URL or station display name | `lambda/stations.json` |
| Playback behavior or default station | `lambda/index.js` |
| Voice phrases, station slot names, or synonyms | `skill-package/interactionModels/custom/en-US.json` |
| Behavior and voice-model regression checks | `tests/` |

Adding a station or changing its spoken aliases requires updating both the station catalog and the interaction model. The spoken channel list automatically includes every catalog entry in catalog order, using `speech` or falling back to `label`. The tests check that model names select the intended streams.

Amazon uses `master` for the deployed development skill, `dev` for code saved in its console editor, and `prod` for a publicly released version. This personal skill uses the development stage. Keep the working branch named `master` for the commands above.

For Alexa-hosted skills using ASK CLI v2, deployment uses Git. The generic `ask deploy` command has no effect. The console's “Import skill from public Git” option starts a new skill from a template; it does not establish this ongoing update workflow for the existing skill.

On another computer, begin with `ask init --hosted-skill-id ...` again and add the GitHub remote. A plain GitHub clone does not include the local Amazon credential helper or Git hooks.

## Testing

```bash
npm test
```

There are no npm dependencies to install. The workflow in `.github/workflows/test.yml` runs the same tests for GitHub pushes and pull requests, with read-only repository permissions. It requires no Amazon secrets and does not deploy.

Local tests cover playback responses, channel listing and follow-up selection, and consistency between the station catalog and voice model. They do not perform live network checks or substitute for a physical Echo playback test. The eight stream URLs were checked on 16 November 2026; they were not rechecked for this repository conversion.

## Voice commands

| Say | Result |
| --- | --- |
| “Alexa, open Finnish radio” | Yle Radio Suomi |
| “Alexa, ask Finnish radio to list channels” | Lists all available stations and asks which to play |
| “Alexa, ask Finnish radio to play radio one” | Yle Radio 1 |
| “… play radio x” | YleX |
| “… play classical” | Yle Klassinen |
| “… play Vega” | Yle Vega |
| “… play x three m” | Yle X3M |
| “… play Sami” | Yle Sámi Radio |
| “… play Lapland” | Yle Radio Suomi / Lapin Radio |

You can also say “list stations.” After listing the channels, Alexa asks “Which station would you like to play?” Reply with a station name, such as “radio one,” to start playback. Listing channels does not issue a playback or stop command.

Stop, resume, next, and previous are supported. Resume restarts the current live broadcast. Opening the skill always starts Radio Suomi.

## References

- [Amazon: manage Alexa-hosted skills with ASK CLI](https://developer.amazon.com/en-US/docs/alexa/hosted-skills/alexa-hosted-skills-ask-cli.html)
- [Amazon: install and configure ASK CLI](https://developer.amazon.com/en-US/docs/alexa/smapi/quick-start-alexa-skills-kit-command-line-interface.html)
- [Amazon: import a new skill from a public Git repository](https://developer.amazon.com/en-US/docs/alexa/hosted-skills/alexa-hosted-skills-git-import.html)
- [Official ASK CLI hosted-skill documentation](https://github.com/alexa/ask-cli/blob/develop/docs/concepts/Alexa-Hosted-Skill-Commands.md)

This is a personal player for public Yle streams. It is not an official Yle skill.
