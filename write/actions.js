// Repo-side steps of "unpublish" and "delete". Pure: takes a GitHub client and plain data.
// app.js owns saving, state, and the screen; this module owns only the order of repo writes.

// Precondition: the caller has already saved the current draft + chat to drafts/ (spec 5.8a).
export async function unpublishPost(gh, { siteRepo, draftsRepo }, { slug, publishedPath, title }) {
  const message = `Unpublish: ${title}`;
  await gh.deleteFile(siteRepo, publishedPath, message);
  await gh.deleteFile(draftsRepo, `archive/${slug}.chat.json`, message);
}

// Stops at the first failure; a retry removes whatever is left (deleteFile skips missing files).
export async function deletePost(gh, { siteRepo, draftsRepo }, { slug, publishedPath, title }) {
  const message = `Delete: ${title}`;
  if (publishedPath) await gh.deleteFile(siteRepo, publishedPath, message);
  for (const path of [`drafts/${slug}.md`, `drafts/${slug}.chat.json`, `archive/${slug}.chat.json`]) {
    await gh.deleteFile(draftsRepo, path, message);
  }
}
