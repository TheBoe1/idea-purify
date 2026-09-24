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
        
        // Handle POST request to /idea
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', async () => {
            console.log('Received idea:', body);
            const CreateIdeaRequest = JSON.parse(body)
            console.log("CreateIdeaRequest",CreateIdeaRequest)
            const RequestIdeaContent =  CreateIdeaRequest.ideaContent
            console.log("RequestIdeaContent",RequestIdeaContent)
            res.writeHead(200, { "Content-Type": "application/json" });
            
            res.end(JSON.stringify({ 
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