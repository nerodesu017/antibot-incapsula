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

const controlFlowDeflatteningVisitor = {
  SwitchStatement(path){
    // First, we check to make sure we are at a good SwitchStatement node
    if(types.isMemberExpression(path.node.discriminant) &&
        types.isIdentifier(path.node.discriminant.object) &&
        types.isUpdateExpression(path.node.discriminant.property) &&
        path.node.discriminant.property.operator === "++" &&
        path.node.discriminant.property.prefix === false){
          // After we've made sure we got to the right node, we'll
          // make a variable that will hold the cases in their order of execution
          // and gather them in it
          let nodesInsideCasesInOrder = [];
          // we gotta get to the parent of the parent
          // our SwitchStatement is wrapped inside a BlockStatement
          // which that BlockStatement is the child of a WhileStatement
          // which is in turn a child of another BlockStatement
          // so if we go 3 levels up, we can get the previous 2 nodes 
          // (the array containing indexes, and index counter)
          let mainBlockStatement = path.parentPath.parentPath.parentPath;
          // after we got 3 levels up, we gotta know the index of our
          // WhileStatement child in the body of the big BlockStatement
          let whileStatementKey = path.parentPath.parentPath.key;
          // after that, we can get the array with the cases in their execution order
          // both are in the save VariableDeclaration node so we substract 1
          // and get the first VariableDeclarator child
          let arrayDeclaration = mainBlockStatement.node.body[whileStatementKey - 1].declarations[0];
          let casesOrderArray = eval(generate(arrayDeclaration.init).code);
          // next, we remember the order of the cases inside the switch
          // we'll use a map like this: caseValue -> caseIndex
          let casesInTheirOrderInSwitch = new Map();
          for(let i = 0; i < path.node.cases.length; i++){
            casesInTheirOrderInSwitch.set(path.node.cases[i].test.value, i);
          }
          // After we've got the cases test values and the cases' keys, we're ready to go!
          for(let i = 0; i < casesOrderArray.length; i++){
            let currentCase = path.node.cases[casesInTheirOrderInSwitch.get(casesOrderArray[i])];
            for(let j = 0; j < currentCase.consequent.length; j++){
              // Don't forget to make sure you don't take a hold of
              // the continue statements
              if(!types.isContinueStatement(currentCase.consequent[j]))
              nodesInsideCasesInOrder.push(currentCase.consequent[j]);
            }
          }
          // after we got the nodes, we first delete delete the VariableDeclaration before our WhileStatement
          mainBlockStatement.get('body')[whileStatementKey - 1].remove();
          // then we replace the WhileStatement (which has only our SwitchStatement)
          // with our nodes we've extracted
          path.parentPath.parentPath.replaceWithMultiple(nodesInsideCasesInOrder);
        }
  }
}

traverse(AST, controlFlowDeflatteningVisitor);
traverse(AST, controlFlowDeflatteningVisitor);

// YOUR VISITORS HERE

const final_code = generate(AST, beautify_opts).code;

fs.writeFileSync('incapsula_final.js', final_code);