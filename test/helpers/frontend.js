// DOM fixture for frontend logic, not visual rendering.
const fs=require('node:fs'), vm=require('node:vm'), http=require('node:http');
const {Duplex}=require('node:stream');
const {createApp}=require('../../backend/server');
const {createAiService}=require('../../backend/services/aiService');
const decode=s=>s.replaceAll('&amp;','&').replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&rarr;','→').replaceAll('&quot;','"');
class Node {
  constructor(tag,doc){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.parentNode=null;this.nodes=[];this.attrs={};this.dataset={};this.style={};this._text='';this.disabled=false;this.hidden=false;}
  get id(){return this.attrs.id||'';} set id(v){this.attrs.id=v;}
  get className(){return this.attrs.class||'';} set className(v){this.attrs.class=v;}
  get classList(){const self=this;return {toggle(name,flag){const names=new Set(self.className.split(/\s+/).filter(Boolean));const on=flag??!names.has(name);if(on)names.add(name);else names.delete(name);self.className=[...names].join(' ');},remove(...names){self.className=self.className.split(/\s+/).filter(n=>!names.includes(n)).join(' ');}};}
  get children(){return this.nodes.filter(n=>n.tagName!=='#TEXT');}
  get isConnected(){return this===this.ownerDocument||Boolean(this.parentNode?.isConnected);}
  get textContent(){return this._text+this.nodes.map(n=>n.textContent).join('');}
  set textContent(v){this.replaceChildren();this._text=String(v);}
  get innerHTML(){return this._html||'';} set innerHTML(v){this.replaceChildren();this._html=v;parse(this,v);}
  get value(){if(this.tagName==='SELECT')return this._value??this.querySelectorAll('option')[0]?.value??'';return this._value??this.attrs.value??(this.tagName==='OPTION'?this.textContent:'');}
  set value(v){this._value=String(v);}
  setAttribute(k,v){this.attrs[k]=String(v);if(k.startsWith('data-'))this.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(v);if(k==='hidden')this.hidden=true;}
  getAttribute(k){return this.attrs[k]??null;} removeAttribute(k){delete this.attrs[k];}
  append(...items){for(let item of items){if(typeof item==='string'){const n=new Node('#text',this.ownerDocument);n._text=item;item=n;}if(item.parentNode)item.parentNode.nodes=item.parentNode.nodes.filter(n=>n!==item);item.parentNode=this;this.nodes.push(item);}}
  replaceChildren(...items){for(const n of this.nodes)n.parentNode=null;this.nodes=[];this._text='';this._value=undefined;this.append(...items);}
  focus(){this.ownerDocument.activeElement=this;}
  setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}
  querySelector(s){return this.querySelectorAll(s)[0]||null;}
  querySelectorAll(selector){
    const selectors=selector.split(',').map(s=>s.trim()),found=[];
    function match(n,p){if(p.startsWith('#'))return n.id===p.slice(1);if(p.startsWith('.'))return n.className.split(/\s+/).includes(p.slice(1));if(p.startsWith('[')){const k=p.slice(1,-1);return k.startsWith('data-')?n.dataset[k.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]!==undefined:n.attrs[k]!==undefined;}return n.tagName===p.toUpperCase();}
    function matches(n,s){const parts=s.split(/\s+/);if(!match(n,parts.pop()))return false;let p=n.parentNode;while(parts.length){const part=parts.pop();while(p&&!match(p,part))p=p.parentNode;if(!p)return false;p=p.parentNode;}return true;}
    function walk(n){for(const c of n.children){if(selectors.some(s=>matches(c,s)))found.push(c);walk(c);}}walk(this);return found;
  }
  addEventListener(name,fn){(this.events||={})[name]=fn;}
}
function parse(root,html){const stack=[root];for(const token of html.match(/<!--[\s\S]*?-->|<[^>]*>|[^<]+/g)||[]){if(token.startsWith('<!'))continue;if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}if(token.startsWith('<')){const tag=token.match(/^<([\w-]+)/)?.[1];if(!tag)continue;const n=new Node(tag,root.ownerDocument);for(const m of token.slice(tag.length+1,-1).matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)'|=([^\s]+))?/g))n.setAttribute(m[1],decode(m[2]??m[3]??m[4]??''));stack.at(-1).append(n);if(!['input','br','img','meta','link','hr'].includes(tag)&&!token.endsWith('/>'))stack.push(n);}else{const n=new Node('#text',root.ownerDocument);n._text=decode(token);stack.at(-1).append(n);}}}
function request(app,path,body,id){return new Promise((resolve,reject)=>{const socket=new Duplex({read(){},write(c,e,done){done();}}),req=new http.IncomingMessage(socket);req.method=body===undefined?'GET':'POST';req.url=path;req.headers={host:'localhost','content-type':'application/json',...(id?{'x-session-id':id}:{})};const payload=body===undefined?null:JSON.stringify(body);if(payload!==null)req.headers['content-length']=String(Buffer.byteLength(payload));const res=new http.ServerResponse(req);res.end=function(c){try{resolve({ok:this.statusCode<400,status:this.statusCode,json:async()=>JSON.parse(String(c))});}catch(e){reject(e);}return this;};app.handle(req,res);if(payload!==null)req.push(payload);req.push(null);});}
function frontend(options={}){
  const document=new Node('document');document.ownerDocument=document;document.createElement=tag=>new Node(tag,document);document.createElementNS=(_,tag)=>new Node(tag,document);document.innerHTML=fs.readFileSync('frontend/index.html','utf8');document.body=document.querySelector('body');
  const app=options.app||createApp({ai:createAiService({apiKey:''})}),storage=options.storage||new Map(),intervals=new Map();let next=0;
  const window={addEventListener(name,fn){this[name]=fn;},dispatchEvent(e){this[e.type]?.(e);}};
  const context=vm.createContext({document,window,Date,AbortSignal,Event,console,BLACKOUT_CONFIG:{apiBaseUrl:''},sessionStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},setInterval:fn=>{intervals.set(++next,fn);return next;},clearInterval:id=>intervals.delete(id),fetch:options.fetch || (async(url,init)=>request(app,url,init.body?JSON.parse(init.body):undefined,init.headers['x-session-id']))});
  vm.runInContext(fs.readFileSync('frontend/app.js','utf8'),context);
  const settle=()=>new Promise(resolve=>setImmediate(resolve));
  return {context,document,storage,app,intervals,settle,async command(value){document.querySelector('#command').value=value;await document.querySelector('#terminal').onsubmit({preventDefault(){}});await settle();},state:()=>JSON.parse(vm.runInContext('JSON.stringify(state)',context)),async fire(selector,event='onclick'){const node=document.querySelector(selector);if(!node)throw Error('Missing UI '+selector);if(node.disabled)throw Error('Disabled UI '+selector);await node[event]({preventDefault(){}});await settle();},async clickText(root,text){const node=document.querySelector(root).querySelectorAll('button').find(n=>n.textContent===text);if(!node)throw Error('Missing button '+text);if(node.disabled)throw Error('Disabled '+text);await node.onclick();await settle();}};
}
module.exports={frontend};
