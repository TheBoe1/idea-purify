import http from "http";
import fs from "fs";
import { db } from './db'
async function testDatabase() {
    const [rows] = await db.query('SELECT 1')
    console.log('MySQL连接成功：', rows)
}

testDatabase()
const server = http.createServer((req, res) => {

    if (req.method === "POST" && req.url === "/idea") {
        const data = fs.readFileSync("./backend/data/ideas.json", "utf-8");
        // Handle POST request to /idea
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            console.log('Received idea:', body);
            res.writeHead(200, { "Content-Type": "application/json" });
            const newIdea = JSON.parse(body);
            console.log("newIdea",newIdea);
            const ideas = JSON.parse(data);
            console.log("ideas",ideas);
            ideas.push(newIdea);
            fs.writeFileSync(
                "./backend/data/ideas.json",
                JSON.stringify(ideas, null, 2),
                "utf-8")
            res.end(JSON.stringify({ 
                message: "Idea received successfully!" ,
                data:body
            }));
        });
        return;
    }
    if (req.method === "GET" && req.url === "/ideas") {

    const data = fs.readFileSync(
        "./backend/data/ideas.json",
        "utf-8"
    );

    res.writeHead(200, {
        "Content-Type": "application/json"
    });

    res.end(data);

    return;
}


    if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Welcome to the home page!\n");
    return;
  }


  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("404 Not Found\n");
  return;
});

server.listen(3000, () => {
  console.log('Node Server Successed running ! \nServer running on port 3000');
});