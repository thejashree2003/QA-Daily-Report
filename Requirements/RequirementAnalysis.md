# Jira Xray – Requirement Analysis

## Objective

Extract and analyze each configured Jira Xray user story using the existing Jira MCP connection and OAuth authentication. The workflow is reusable and obtains all inputs from `Configuration/JiraInput.md`.

## Input Configuration

1. Read `Configuration/JiraInput.md` completely before starting Jira work.
2. Read every non-empty data row in its table. Each row supplies a Project Key and User Story ID.
3. Process each configured row as a separate Jira story. Do not stop after the first row.
4. Do not ask the user to re-enter values already present in the configuration.
5. If the file, table, column names, or a required value is missing or malformed, report the specific problem and do not guess or silently skip a row.
6. Do not hardcode Jira Project Keys or User Story IDs in this instruction file. The configuration table is the only input source.

## Workflow

For each configured row, in table order:

### 1. Extract User Story

- Connect to Jira using the existing MCP and OAuth authentication.
- Retrieve the specified issue and verify its issue key and project.
- Retrieve the complete available story details, including summary, description, acceptance criteria, business rules, dependencies, preconditions, attachments, comments, and linked issues.
- Save the extracted story in `user-stories/<ISSUE_ID>/user-story.md`.
- Do not modify the original Jira user story.

### 2. Analyze Requirements

Identify:

- Missing or incomplete requirements.
- Unclear or ambiguous statements.
- Missing acceptance criteria and business rules.
- Missing field validations and expected results.
- Missing positive, negative, boundary, and exception scenarios.
- Dependencies, assumptions, risks, and conflicting requirements.
- Any additional gaps or scenarios overlooked during story creation.

Do not invent requirements or assume expected behavior. Distinguish facts retrieved from Jira from analysis, assumptions, and clarification questions. Mark uncertainty explicitly.

### 3. Generate Analysis Report

Include:

- User Story Summary
- Requirements and Acceptance Criteria Analysis
- Identified Gaps and Missing Information
- Ambiguities and Clarification Questions
- Missing Test Scenarios
- Dependencies and Risks
- Recommendations
- Requirement Completeness and Test Readiness

For each gap, include its reference, description, impact, priority, and clarification question.

Save the report in `user-stories/<ISSUE_ID>/requirement-analysis.md`.

### 4. Maintain User Story Index

Maintain `user-stories/README.md` with one entry per analyzed issue, including:

- Jira Issue ID and Title
- Jira URL
- Local Folder
- Analysis Status
- Last Analyzed Date

Create one separate folder per Jira Issue ID. When re-analyzing an existing issue, update its existing files and index row rather than creating duplicate files or rows. Do not mark an issue analyzed unless extraction and analysis were completed.

### 5. Jira Comment

- Prepare a comment summarizing that issue's findings and clarification questions.
- Show the complete proposed comment to the user and obtain explicit approval before posting.
- For a multi-story run, present all proposed comments, clearly identified by Jira Issue ID, and wait for approval before posting any of them.
- Post only approved comments to their corresponding issues and verify each posting.
- Never modify the original Jira user story.

### 6. Execution Summary

Report, for each configured row, extraction status, analysis status, number of gaps, clarification questions, report location, Jira comment status, and pending activities. Also report the total number of configured rows and any failed or blocked rows.

## Rules

- Use the existing Jira MCP tools and OAuth connection.
- Never hardcode or expose credentials.
- Do not fabricate information.
- Verify successful operations.
- Report authentication, permission, and integration failures clearly.
- Never post a Jira comment without explicit user approval.
- Do not execute Jira analysis for a row that was not read from the configuration file.

## Execution

Use this file as the single source of workflow instructions. On each run, read every configured row from `Configuration/JiraInput.md` and process each story separately.