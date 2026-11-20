# Security policy

## Supported versions

Only the latest release gets security fixes.

## Reporting a vulnerability

Please report privately via GitHub: Security tab → "Report a vulnerability". Don't open a public issue.
We aim to reply within 7 days and to fix confirmed issues in the next release.

## Scope

repo-desk reads untrusted text (issues and PRs) and, when a person approves, writes to GitHub and Slack through the One CLI. We especially want to hear about:

- ways issue or PR text can make repo-desk write something the user did not approve, such as prompt injection that gets past the desk or labels outside the repository's own label set;
- ways another website or local process can drive the desk server, which should only accept requests from its own page;
- shell or argument injection into the One CLI call;
- anything that writes connection keys, tokens or issue text somewhere the user didn't expect.
