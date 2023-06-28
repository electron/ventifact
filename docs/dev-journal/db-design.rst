=================
 Database Design
=================

This document details the initial database design for Ventifact, along with some of the rationale that guides the design decisions.


Constraints
===========

Ventifact is expected to be deployed and hosted on an external cloud hosting service, so the database must be optimized to work within the one of the two following constraints (imposed by our hosting provider):

1. (The cheaper tier.) Total row count is capped at 10 million rows.
  * There is a smaller option which is capped at 10 *thousand* rows, but that is likely too small.
2. (The more expensive tier.) Total db size is capped at 64 GB.
  * There are (many) larger options available, but this is the largest size we  want to pick for an auxiliary application like Ventifact, due to pricing.

These two constraints represent two separate service tiers, so we are only bound by one or the other at a time, not both. The goal of the database design in this document is to primarily fit within the first constraint, but have a graceful fallback to operating within the second constraint if need be.

We are constrained to using PostgreSQL as our database engine.


Load Projection Analysis
========================

The database design is informed by actual data of how Electron is currently tested. By analyzing how many tests we run, how often they're run, and how similar test runs are, we can design the database in a way that helps us stay within the constraints.

The Raw Numbers
---------------

This data was collected from a database that contains a large history of test runs from Electron. Only test runs on CircleCI have been collected, so this data only samples our macOS and Linux CI test runs. The queries were run on 26 June 2023.

* As a sample, a recent darwin-testing-arm64-tests run had 2531 test results.
* A sample of the 1000 most recent test runs had a range of test result counts from 389 to 2593. In buckets:
  * 0-1000 results: 4 runs.
  * 1000-2000 results: 16 runs.
  * 2000-3000 results: 980 runs.
    * 2000-2100 results: 0 runs.
    * 2100-2200 results: 51 runs.
    * 2200-2300 results: 347 runs.
    * 2300-2400 results: 144 runs.
    * 2400-2500 results: 126 runs.
    * 2500-2600 results: 312 runs.
    * 2600+ results: 0 runs.
  * (Aside: no test result count landed right on the bucket boundaries, so it's not important whether the rangers are inclusive or exclusive.)
* Of the last 5,000,000 test results (approx. 2174 test runs), there were only 529 failures in total. The remaining 4,999,471 results were successes.

Observations
------------

* Successes are overwhelmingly the most common case. We might be able to get away with designing the database with the assumption that tests pass, only noting exceptions from that assumption.
* The average test run currently runs about 2300 or 2600 tests.
  * Open question: how does this number change over time? I didn't feel like the database I was using was performant enough to run a query like this.


Schema
======

Design decisions
----------------

To do.

Specification
-------------

To do.


Usage
=====

To do.
