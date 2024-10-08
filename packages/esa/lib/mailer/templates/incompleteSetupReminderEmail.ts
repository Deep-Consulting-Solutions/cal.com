type Issue = { email: string; pendingTasks: string[] };
const issuesSnippet = (issue: Issue) => {
  return (
    `<p>Email: ${issue.email}<p/>` + `<ul>${issue.pendingTasks.map((i) => `<li>${i}</li>`)}</ul><br><br>`
  );
};

export default function incompleteSetupReminderEmail(data: Issue[]) {
  return `
<p>The following users have issues with their Cal setup<p/>
<br>
${data.map((issue) => issuesSnippet(issue))}
`;
}
