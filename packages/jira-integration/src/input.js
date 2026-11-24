function splitMarkdownRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isSeparatorRow(cells) {
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

export function parseJiraInputMarkdown(markdown) {
  let header;
  let projectColumn = -1;
  let issueColumn = -1;
  const stories = [];
  const seen = new Set();

  for (const line of markdown.split(/\r?\n/)) {
    if (!line.trim().startsWith("|")) continue;
    const cells = splitMarkdownRow(line);

    if (!header) {
      projectColumn = cells.indexOf("Project Key");
      issueColumn = cells.indexOf("User Story ID");
      if (projectColumn >= 0 && issueColumn >= 0) header = cells;
      continue;
    }

    if (isSeparatorRow(cells) || cells.every((cell) => !cell)) continue;
    if (cells.length !== header.length) {
      throw new Error(`Malformed configuration table row: ${line}`);
    }

    const projectKey = cells[projectColumn];
    const issueKey = cells[issueColumn];
    if (!/^[A-Z][A-Z0-9]*$/.test(projectKey)) {
      throw new Error(`Invalid Project Key in JiraInput.md: ${projectKey || "(empty)"}`);
    }
    if (!/^[A-Z][A-Z0-9]*-\d+$/.test(issueKey) || !issueKey.startsWith(`${projectKey}-`)) {
      throw new Error(`Invalid User Story ID for ${projectKey}: ${issueKey || "(empty)"}`);
    }
    if (seen.has(issueKey)) {
      throw new Error(`Duplicate User Story ID in JiraInput.md: ${issueKey}`);
    }

    seen.add(issueKey);
    stories.push({ projectKey, issueKey });
  }

  if (!header) {
    throw new Error('JiraInput.md must contain a table with "Project Key" and "User Story ID" columns.');
  }
  if (stories.length === 0) {
    throw new Error("JiraInput.md contains no configured story rows.");
  }
  return stories;
}
