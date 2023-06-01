# Ventifact

> 🪨 _"stone polished by wind-blown sand"_

Ventifact monitors automated test results, providing a dashboard to track overall test health as well as powering automation to detect and disable flaky tests.

> **Warning**
> ⚠️ This application is still under development and is not close to feature
> completion yet.

# Components

## Limited-History Test Database

Ventifact maintains a database of recent test results, used to power its dashboard and flaky test detection. The database is kept current, persistent across restarts, and is automatically self-pruned to keep its size manageable.

The database supports two modes: _construction_, where the database is created from scratch; and _maintenance_, where the database is routinely updated with the newest test results and pruned of old results.

The database's primary purpose is only to store data that is most likely to be currently relevant. It is not intended to be a complete history of all test results.

## Dashboard

> 🚧 To do.

The dashboard provides a high-level overview of test health, including:

- Charts displaying various metrics of test health:
  - Rolling average of merged PR statuses (🟢 passing, 🔴 failing, etc.)
  - Potential test flakes
- List of recent test failures on `main`
- List of recent test flakes on `main`
- Per-test details & recent history
- Disabled test tracking

## Flaky Test Automation

> 🚧 To do.

Ventifact employs strategies and heuristics to identify flaky tests and will smartly create PRs that suggest disabling them.

# Project Structure

Conceptually, Ventifact is a collection of packages, divided into three categories:

- **Services** (`*-svc`) are long-running processes that provide ongoing functionality.
- **Tasks** (`*-tsk`) are short-lived processes that perform and encompass a specific action.
- **Libraries** (`*-lib`) are shared code across services and/or tasks (or simply act as an encapsulation boundary).

Each category has a corresponding package name suffix, as shown above. Packages can be found in the top-level `packages/` directory and are managed by

## Yarn 2+

This project uses the "new" version of Yarn (aka *Berry*); that is, this project **does not use Yarn 1.x**. You will need a recent version of Node.js to use this project as intended.
