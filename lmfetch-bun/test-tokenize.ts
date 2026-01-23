// Test tokenization of ".execute" query

function tokenize(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase()
    .split(/[\s\W]+/)
    .filter((t) => t.length > 1);
}

const query = "explain the flow in which the .execute method is called";
const tokens = tokenize(query);

console.log("Query:", query);
console.log("Tokens:", tokens);
console.log("\nCode examples:");
console.log("'.execute(' ->", tokenize(".execute("));
console.log("'tool.execute' ->", tokenize("tool.execute"));
console.log("'async execute()' ->", tokenize("async execute()"));
