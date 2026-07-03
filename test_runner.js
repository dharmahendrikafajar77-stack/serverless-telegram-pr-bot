const fs = require('fs');
let code = fs.readFileSync('Code.js', 'utf8');
code = code.replace('var text = msg.text || msg.caption || "";', 'var text = msg.text || msg.caption || "";\nconsole.log("TEXT IS:", text);\n');
code += '\nvar e = { postData: { contents: JSON.stringify({ message: { chat: { id: 123 }, text: "/info@UKBAPR_Bot" } }) } };\ntry { doPost(e); } catch(err) { console.log(err.message); }';
fs.writeFileSync('test.js', code);
