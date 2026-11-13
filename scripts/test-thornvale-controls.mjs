import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as THREE from '../demos/_shared/three-r187/build/three.webgpu.js';
import {ThirdPerson} from '../demos/thornvale/src/character.js';
import {updateFly, lookFly} from '../demos/thornvale/src/fly-controls.js';
class Events {
  listeners = new Map();
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(callback);
  }
  emit(type, event = {}) {
    for (const callback of this.listeners.get(type) || []) callback({preventDefault() {}, ...event});
  }
}
globalThis.window = new Events();
globalThis.document = new Events();
globalThis.innerWidth = 320;
const dom = new Events();
const camera = new THREE.PerspectiveCamera();
const obbs = [];
// Use the actual gate declarations, not a second set of collision dimensions.
const town = readFileSync(new URL('../demos/thornvale/src/town.js', import.meta.url), 'utf8');
const gate = town.match(/addObb\(gx - 4\.6[^;]*;[\s\S]*?addObb\(gx \+ 4\.6[^;]*;/)[0];
vm.runInNewContext(gate, {gx: 0, gz: 85, addObb(x,z,hw,hd) {obbs.push({x,z,hw,hd,c:1,s:0});}});
assert.equal(obbs.length, 2);
const character = {root: new THREE.Group(), mixer: {update() {}}, actions: {}};
const world = {sample: () => 22, obbs, circles: []};
const hero = new ThirdPerson(camera, dom, character, world);
assert.equal(hero.blocked(0,85), false, 'Gate centre must be traversable');
assert.equal(hero.blocked(1.5,85), false, 'Character-radius clearance inside passage');
assert.equal(hero.blocked(2.1,85), true, 'Gatehouse walls still collide');
hero.pos.set(0,22,80); hero.yaw = Math.PI; hero.heading = 0; hero.start(); hero.keys.add('KeyW');
for (let i=0;i<300;i++) hero.update(1/30);
assert(hero.pos.z > 95, 'Walking must cross the gate to the outside road');
hero.keys.clear(); hero.stop(); hero.touchEnabled = true;
const fly = {keys: hero.keys, touchMove: hero.touchMove, yaw: 0, pitch: 0, pos: new THREE.Vector3(0,40,0)};
hero.onTouchLook = (dx,dy) => lookFly(fly,dx,dy);
dom.emit('touchstart', {changedTouches:[{identifier:1,clientX:40,clientY:150},{identifier:2,clientX:250,clientY:150}]});
dom.emit('touchmove', {changedTouches:[{identifier:1,clientX:40,clientY:90},{identifier:2,clientX:270,clientY:170}]});
assert.equal(hero.touchMove.y, -1);
assert(fly.yaw < 0 && fly.pitch < 0, 'Right touch turns and pitches the flight camera');
updateFly(fly,camera,world,1/30);
assert(fly.pos.z < 0 && fly.pos.distanceTo(new THREE.Vector3(0,40,0)) > 0.5, 'Left touch actually moves Fly mode');
assert(camera.position.equals(fly.pos));
dom.emit('touchcancel',{changedTouches:[{identifier:1}]});
assert.equal(hero.touchMove.lengthSq(),0,'Cancelled touch must stop movement');
dom.emit('touchend',{changedTouches:[{identifier:2}]});
hero.stop();
const yaw=fly.yaw;
dom.emit('touchstart',{changedTouches:[{identifier:3,clientX:250,clientY:100}]});
dom.emit('touchmove',{changedTouches:[{identifier:3,clientX:290,clientY:150}]});
assert.equal(fly.yaw,yaw,'Inactive Fly mode must not consume touch input');
hero.touchMove.set(1,1); hero.keys.add('KeyW'); window.emit('blur');
assert.equal(hero.touchMove.lengthSq(),0); assert.equal(hero.keys.size,0);
console.log('Thornvale controls: walking gate passage, touch flight/look, cancellation, mode handoff and blur pass');
