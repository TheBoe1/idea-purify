import http from "http";
import fs from "fs";
const server = http.createServer((req, res) => {
    const data = fs.readFileSync("./backend/data/ideas.json", "utf-8");
    if (req.method === "POST" && req.url === "/idea") {
        // Handle POST request to /idea
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
        });
        req.on('end', () => {
            console.log('Received idea:', body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ 
                message: "Idea received successfully!" ,
                data:body
            }));
        });
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