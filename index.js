const fs = require('fs');
const types = require('@babel/types');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;

let testing_opts = {
  comments: false,
  minified: true,
  concise: true,
}

let beautify_opts = {
  comments: true,
  minified: false,
  concise: false,
}

const script = fs.readFileSync('incapsula_unpacked.js', 'utf-8');

const AST = parser.parse(script, {})

// YOUR VISITORS HERE

const hexToAsciiVisitor = {
  StringLiteral(path){
    delete path.node.extra.raw;
  },
  NumericLiteral(path){
    delete path.node.extra.raw;
  }
}

traverse(AST, hexToAsciiVisitor);

const names = require('./names.js');

const renameVisitor = {
  Identifier(path){
    if(path.node.name.startsWith('_0x')){
      path.scope.rename(path.node.name, names.shift());
    }
  }
}

traverse(AST, renameVisitor);

let decipheringNodes = [];
for (let node of AST.program.body) {
  if (node.type === 'VariableDeclaration' ||
    (
      node.type === 'ExpressionStatement' &&
      node.expression.arguments.length !== 0
    )) decipheringNodes.push(node);
}
let decipher = generate({
  type: "Program",
  body: decipheringNodes
}, testing_opts).code;
const decipherAST = parser.parse(decipher);

const makeDeclarationsGlobalForEvalVisitor = {
  VariableDeclaration(path) {
    let newDeclarations = [];
    let kind = path.node.kind;
    if (kind === 'var') {
      for (let declaration of path.node.declarations) {
        switch (declaration.id.type) {
          case "Identifier":
            let left_side = types.memberExpression(types.identifier('global'), types.identifier(declaration.id.name));
            let right_side = (declaration.init === null) ? types.nullLiteral() : declaration.init;
            let varToGlobal = types.expressionStatement(
              types.assignmentExpression('=', left_side, right_side));
            newDeclarations.push(varToGlobal);
        }
      }
      path.replaceWithMultiple(newDeclarations);
    }
  }
}

traverse(decipherAST, makeDeclarationsGlobalForEvalVisitor);
decipher = generate(decipherAST, testing_opts).code;

let nodes = [];
const replaceCallExpressionRC4Visitor = {
  CallExpression(path) {
    if (path.node.arguments.length == 2 &&
      types.isStringLiteral(path.node.arguments[0]) &&
      types.isStringLiteral(path.node.arguments[1]) &&
      types.isIdentifier(path.node.callee) &&
      String(path.node.arguments[0].value).startsWith("0x")) {
      let newNode = {
        type: "StringLiteral",
        value: eval(decipher + `;${generate(path.node).code}`)
      };
      path.replaceWith(newNode);
    }
  }
}

traverse(AST, replaceCallExpressionRC4Visitor);

const objectSqBracketsToDotNotationVisitor = {
  MemberExpression(path) {
    if (types.isStringLiteral(path.node.property)) {
      let property_name = path.node.property.value;
      let newNode = types.identifier(property_name);
      path.node.computed = false;
      path.node.property = newNode;
    }
  }
}

traverse(AST, objectSqBracketsToDotNotationVisitor);

const unaryExpressionsVisitor = {
  UnaryExpression(path){
    if(path.node.operator === '!'){
      switch(path.node.argument.type){
        case 'UnaryExpression':
          if(path.node.argument.argument.type === "ArrayExpression" &&
              path.node.argument.argument.elements.length === 0){
                path.replaceWith(types.booleanLiteral(true));
              }
          break;
        case 'ArrayExpression':
          if(path.node.argument.elements.length === 0){
            path.replaceWith(types.booleanLiteral(false));
          }
          break;
      }
    }
  }
}

traverse(AST, unaryExpressionsVisitor);

// YOUR VISITORS HERE

const final_code = generate(AST, beautify_opts).code;

fs.writeFileSync('incapsula_final.js', final_code);