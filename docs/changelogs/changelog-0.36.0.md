# Changelog — Meow Coding v0.35.2 → v0.36.0

## 🐛 Bug Fixes
- Agent loop: a model that got stuck repeating the same thinking, or re-calling the same tool with the same input, no longer runs unbounded — it is nudged twice then the turn ends with a clear "got stuck repeating itself" message.
- Agent loop: cutting a looping stream short now actually cancels the provider request, so a stuck turn stops billing tokens instead of streaming invisibly in the background.
- Agent loop: repetition is now detected across steps, not just within a single response, so a loop spread over several tool calls is caught.

## 🚀 New Features
- Added a tool-call repetition guard (`toolLoopDetector`) that fingerprints each tool name + input and flags a call repeated too often in a sliding window — covers loops where the model varies its wording but keeps making the identical call.

## 🧹 Internal & Docs
- Both loop guards (`loopDetector`, `toolLoopDetector`) are now held per run instead of per step, and reset after a successful recovery so a clean answer is not misread as a loop.
- Added unit + integration tests for cross-step repetition, identical tool-call loops, and provider-stream abort on loop break.
- Bumped version to 0.36.0.
