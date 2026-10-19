const fs = require("fs");
const path = require("path");

const root = process.cwd();
const contentDir = path.join(root, "content");
const outDir = path.join(root, "static", "tree");
const outFile = path.join(outDir, "index.html");

const SKIP = new Set(["tree", "image"]);

function readTitle(file) {
    try {
        const txt = fs.readFileSync(file, "utf8");
        const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        if (m) {
            const t = m[1].match(/^title:\s*["']?(.+?)["']?\s*$/m);
            if (t) return t[1];
        }
    } catch (e) {}
    return null;
}

function walk(dir, rel, out) {
    let entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.sort((a, b) => {
        const ad = a.isDirectory() ? 0 : 1;
        const bd = b.isDirectory() ? 0 : 1;
        if (ad !== bd) return ad - bd;
        return a.name.localeCompare(b.name);
    });
    const dirs = [];
    const files = [];
    for (const e of entries) {
        if (e.name === "_index.md" || e.name.startsWith(".")) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) dirs.push(e);
        else if (e.isFile() && e.name.endsWith(".md")) files.push(e);
    }
    for (const d of dirs) {
        if (SKIP.has(d.name)) continue;
        const bundleIndex = path.join(dir, d.name, "index.md");
        if (fs.existsSync(bundleIndex)) {
            // 页面包(PKU伙食大测评/index.md):整个文件夹算一篇文章
            const title = readTitle(bundleIndex);
            out.push({ type: "file", name: d.name, rel: rel + "/" + d.name, title });
            continue;
        }
        const sub = [];
        walk(path.join(dir, d.name), rel + "/" + d.name, sub);
        out.push({ type: "dir", name: d.name, rel: rel + "/" + d.name, children: sub });
    }
    for (const f of files) {
        const full = path.join(dir, f.name);
        if (fs.statSync(full).size === 0) continue;
        const name = f.name.replace(/\.md$/, "");
        const title = readTitle(full);
        out.push({ type: "file", name: name, rel: rel + "/" + name, title });
    }
}

function enc(segments) {
    return "/" + segments.map(s => encodeURIComponent(s.toLowerCase())).join("/") + "/";
}

function render(items, segments, depth) {
    let html = "";
    const pad = depth * 24;
    for (const it of items) {
        const seg = segments.concat(it.name);
        if (it.type === "dir") {
            const sub = it.children.length ? render(it.children, seg, depth + 1) : "";
            const count = it.children.filter(c => c.type === "file").length + it.children.filter(c => c.type === "dir").length;
            html += `<div class="tree-item" style="margin-left:${pad}px">
<details${sub ? " open" : ""}><summary>📁 <a href="${enc(seg)}">${escapeHtml(it.name)}</a> <span class="tree-count">(${count})</span></summary>
${sub}</details></div>\n`;
        } else {
            const title = it.title ? ` — <span class="tree-title">${escapeHtml(it.title)}</span>` : "";
            html += `<div class="tree-item" style="margin-left:${pad}px">
<span class="tree-file">📄 <a href="${enc(seg)}">${escapeHtml(it.name)}.md</a>${title}</span></div>\n`;
        }
    }
    return html;
}

function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

fs.mkdirSync(outDir, { recursive: true });
const items = [];
walk(contentDir, "", items);

const html = `<!DOCTYPE html>
<html lang="zh-cn">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>站点文件结构 | iorit 的博客</title>
<style>
body{font-family:"Segoe UI",system-ui,"Microsoft YaHei",sans-serif;max-width:900px;margin:0 auto;padding:20px;line-height:1.7;background:#fff;color:#222}
a{color:#1f6fb2;text-decoration:none}
a:hover{text-decoration:underline}
.tree-item{margin:2px 0}
details summary{cursor:pointer;padding:2px 0}
.tree-count{color:#888;font-size:.85em}
.tree-title{color:#888}
.tree-file{color:#444}
code{background:#f4f4f4;padding:1px 5px;border-radius:3px}
</style>
</head>
<body>
<h1>站点文件结构</h1>
<p>这是本站 <code>content/</code> 目录下的文章文件结构,由脚本自动生成。</p>
${render(items, [], 0)}
<hr>
<p><a href="/">← 返回首页</a></p>
</body>
</html>`;

fs.writeFileSync(outFile, html, "utf8");
console.log("generated", outFile);
