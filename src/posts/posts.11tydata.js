const todaysDate = new Date();
const isDev = require("../../_data/isdevelopment")();

function showDraft(data) {
  if (isDev) return true;
  const isDraft = "draft" in data && data.draft !== false;
  const isPostInFuture =
    "scheduled" in data ? data.scheduled > todaysDate : false;
  return !isDraft && !isPostInFuture;
}

module.exports = () => {
  return {
    eleventyComputed: {
      eleventyExcludeFromCollections: (data) =>
        showDraft(data) ? data.eleventyExcludeFromCollections : true,
      permalink: (data) => {
        if (!showDraft(data)) {
          return false;
        }
        if (data.permalink) {
          return data.permalink;
        }
        const stem = (data?.page?.filePathStem || "").replace(/^\/?src\//, "");
        if (!stem.startsWith("posts/")) {
          return data.permalink;
        }
        const relative = stem
          .replace(/^posts\//, "")
          .replace(/\/index$/, "");
        return `/posts/${relative}/index.html`;
      },
    },
    tags: ["posts"],
  };
};
