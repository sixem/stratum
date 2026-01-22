export const getEmptyMessage = (query: string) => {
  if (query.trim()) {
    return { title: "No matches", subtitle: `No results for "${query}".` };
  }
  return { title: "This folder is empty", subtitle: "Try another path or refresh." };
};
