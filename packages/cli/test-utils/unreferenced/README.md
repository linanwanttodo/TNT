# Unreferenced

Nothing in the repository names these modules: no `vi.mock("<path>")` or `vi.importMock` specifier
resolves to them, no same-named sibling module makes them an automatic `__mocks__` replacement for a
file under `src/`, and no config glob (`vitest*.config.ts`, `tsconfig*.json`, `eslint.config.js`)
picks them up by name. That is the loader-level check, because a text grep for an import statement
cannot see any of the three mechanisms.

They are kept here, unmounted but still type-checked and linted, rather than deleted in the same
breath as the search that found them unreferenced. `grep` returning nothing can only open a case,
not convict it: the search misses mock resolution and any specifier assembled at runtime.

Deleting them is a separate commit with that evidence restated against the tree as it is then.
