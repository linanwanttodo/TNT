# Session artifacts

The `UploadArtifact` tool copies a file the run produced - a screenshot, a recorded
clip, a log - into the current session's own folder so the person reading the
transcript can open it. Nothing leaves the machine: there is no upload, no token,
no object storage and no backend.

## Where they go

`<global dir>/sessions/<session>/artifacts/<filename>`, created on first use with
mode `0700` by `ensureSessionScopedDir` in `src/session/paths.ts`. The session id is
the one the run is already writing its transcript under (`getCurrentSessionId`), so
an artifact belongs to the session it was produced in; `tnt rm` deletes the session
directory recursively and the artifacts go with it.

## What is accepted

Images (`png`, `jpg`, `jpeg`, `gif`, `webp`), video (`mp4`, `mov`, `avi`, `webm`) and
text (`log`, `txt`, `json`, `xml`, `csv`, `html`). The extension is checked against
that set rather than sniffed, because the point of the list is what a reviewer can
open, not what the bytes happen to be.

Two ceilings, both enforced before anything is written:

- 50 MB per file
- 500 MB per session, counting what is already there minus the file being replaced

## Overwriting

An artifact is addressed by name. Saving `plot.png` twice replaces the first one,
which is what you want when a chart is regenerated; use a different name when both
versions matter.

The copy lands as `<name>.<pid>.partial` and is renamed over the target. A crash
part-way through therefore leaves a stray `.partial` file rather than a truncated
file carrying the name the model just told the user about.

## Invoking it

The tool is behind `--beta-upload-artifact-tool`, and the surface guard in
`src/tools/documentedSurface.test.ts` keeps that statement true.

```
tnt --beta-upload-artifact-tool
> /help            # the tool list now includes Upload Artifact
```

Then ask for the file to be attached, or let the model call it after producing one.
The result line is the path it was saved to, in the separator style the rest of the
CLI prints.

## Verifying

```bash
cd packages/cli
npx vitest run src/tools/uploadArtifact.test.ts
```

The spec writes a file, saves it, reads it back off disk, and checks that a fourth
extension outside the allowed set, a file over the per-file ceiling, and a missing
path each refuse with a message that says why.
