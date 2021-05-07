const fs = require('fs');

let names = [];

fs.readdirSync('./names').forEach(fileName => {
  const names_in_file = fs.readFileSync('./names/' + fileName, 'utf-8').split(',').map(item => item.toLowerCase());
  names = names.concat(names_in_file);
})
names = Array.from(new Set(names));
module.exports = names;