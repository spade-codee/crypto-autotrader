# Strategy automation and customization — product proposal

24 September 2026. The founder asked whether liquidity trading will be automated and
whether users can tweak it. This is a proposed contract for Claude to reconcile with
the research plan and future backend design, not a shipped capability.

- Automate the complete eligible sequence: observe, arm, confirm, enter, reconcile
  fills, maintain protection and exit. Research v0 is offline only for now.
- Keep the research baseline immutable. A user's preferences must not mutate the
  preregistered experiment or silently alter a running version.
- Initially offer strategy selection and validated presets. Consider bounded risk
  controls only after sizing, account minimums and ownership rules support them.
  A requested risk percentage is a sizing input, not a guaranteed loss cap.
- Distinguish account preferences from strategy parameters. Changing swing windows,
  entry filters, confirmation duration, stop, target or time exit creates a distinct
  configuration. Original performance is not evidence for that altered configuration.
- Save exact version plus parameter snapshot. Show the configuration's own evidence
  status, bounds, trade-offs and effective time. Require a preview and explicit
  confirmation; never silently rewrite protective exits on an open position.
- Custom configurations begin in research/practice. Define eligibility separately
  before offering any live activation. Do not imply unlimited tuning is supported.
- One strategy still owns the dedicated account. Smaller trade sizing does not
  implicitly permit other bots to trade the remaining balance.

Questions for Claude: which parameters can the planned harness accept; which should
remain locked in v0; how will configuration identity and eligibility be recorded;
and when can a changed setting take effect without disturbing an open position?

UI scope this turn: explanatory copy only. No sliders, pretend save actions or
activation controls are added ahead of those answers.
