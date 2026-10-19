// 把 Obsidian 图片语法转换为 Hugo 可识别的格式
// 1) ![[IMG.jpg|400]]      -> ![](IMG.jpg)  + 下一行 {width=400}
// 2) ![[IMG.jpg]]          -> ![](IMG.jpg)
// 3) ![](IMG.jpg|400)      -> ![](IMG.jpg)  + 下一行 {width=400}
const fs = require("fs");
const path = require("path");

const contentDir = path.join(process.cwd(), "content");

function walk(dir, out) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, out);
        else if (e.name.endsWith(".md")) out.push(full);
    }
}

const wiki = /!\[\[([^\]\|]+?)(?:\|(\d+))?\]\]/g;
const pipe = /!\[([^\]]*)\]\(([^\)\|]+)\|(\d+)\)/g;

const files = [];
walk(contentDir, files);
let changed = 0;

for (const f of files) {
    let c = fs.readFileSync(f, "utf8");
    const orig = c;
    c = c.replace(wiki, (_, name, size) => {
        if (size) return `![](${name})\n{width=${size}}`;
        return `![](${name})`;
    });
    c = c.replace(pipe, (_, alt, name, size) => `![${alt}](${name})\n{width=${size}}`);
    if (c !== orig) {
        fs.writeFileSync(f, c, "utf8");
        console.log("fixed:", path.relative(process.cwd(), f));
        changed++;
    }
}
console.log(`obsidian links converted: ${changed}`);
