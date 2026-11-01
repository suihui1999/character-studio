# Security / 安全问题

For vulnerability reports, use GitHub's **Security → Report a vulnerability** feature when available. Do not post exploit details, API keys, private portraits, or complete personal data folders in a public issue. If private reporting is unavailable, open a minimal issue requesting a private reporting channel, without sensitive details.

安全漏洞请优先通过仓库 Security 页的私密报告入口提交。不要在公开 Issue 中粘贴 Key、私人人像或整个本机数据目录；没有私密入口时，可先发不含敏感细节的联系请求。

For ordinary bugs and installation failures, use the [issue templates](https://github.com/web3suihuiji-ctrl/character-studio/issues/new/choose).

## Scope and current behavior

- User data is stored separately from versioned program files.
- The HTTP server listens on loopback and checks request Host/Origin.
- Release installation verifies the archive checksum and package file manifest.
- RunningHub keys are stored per provider; Windows uses the current user's DPAPI protection. Other source-development platforms use restricted file permissions.
- External catalog content, images, and imported workflow examples are data, not executable instructions.
- Generation failures do not trigger moderation bypasses, fabricated success, or automatic switching to a paid provider.

This early project has no formal security audit or guaranteed response SLA. Fixes target the current release line; update to the latest version before reporting an already fixed issue.
