# axe-core

`axe.min.js` is the unmodified browser distribution from `axe-core@4.14.0`.
Upstream: https://github.com/dequelabs/axe-core (MPL-2.0; see `axe-LICENSE`).

The exact npm dependency and lockfile pin its source. Browser code must be self-contained
when installed, so this distribution is committed with the browser files. On upgrades,
copy `node_modules/axe-core/axe.min.js` and `LICENSE` here and run the tests; the
integrity test checks that the vendored files match the installed package.

It runs in a disposable content-principal sandbox, with no remote code fetch and no
page-global `axe` installation. Every frame is audited separately with `iframes:false`.
