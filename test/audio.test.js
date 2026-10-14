'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {Director,files}=require('../public/game-audio');
function harness(){const plays=[],stops=[],ticks=[];const d=new Director({play:(name,options)=>plays.push({name,...options}),stop:g=>stops.push(g),countdown:s=>ticks.push(s)});const state={round:1,phase:'freeze',freeze:6,roundLeft:115,bombState:'carried',bombLeft:0,defuser:0,planting:0,alive:true};return {d,state,plays,stops,ticks};}
test('freeze countdown emits one cue per displayed second despite repeated or older snapshots',()=>{
 const h=harness();for(const t of [6,5,5,4.5,4,4.3,3,2,1,.9,0])h.d.update({...h.state,freeze:t});
 assert.deepEqual(h.ticks,[5,4,3,2,1]);assert.equal(h.plays.filter(p=>p.name==='music_startround_01.mp3').length,1);
 h.d.update({...h.state,phase:'live'});h.d.update({...h.state,phase:'live'});assert.deepEqual(h.ticks,[5,4,3,2,1,0]);
});
test('joining an active round never replays its opening and ten-second cues seek past elapsed time',()=>{
 const h=harness();h.d.update({...h.state,phase:'live',roundLeft:7});h.d.update({...h.state,phase:'live',roundLeft:6});
 assert.equal(h.plays.length,1);assert.equal(h.plays[0].offset,3);assert.deepEqual(h.ticks,[]);
 h.d.update({...h.state,phase:'live',bombState:'planted',bombLeft:8});assert.equal(h.plays.length,2);assert.equal(h.plays[1].offset,2);
});
test('plant cancellation, defuser changes and leaving stop pending action sounds',()=>{
 const h=harness(),state={...h.state,phase:'live',planting:.1};h.d.update(state);h.d.update({...state,planting:.2});assert.equal(h.plays.length,1);
 h.d.update({...state,planting:0});assert.ok(h.stops.includes('plant'));
 h.d.update({...state,planting:0,bombState:'planted',bombLeft:30,defuser:3});h.d.update({...state,planting:0,bombState:'planted',bombLeft:29,defuser:3});
 assert.equal(h.plays.filter(p=>p.group==='defuse').length,1);
 h.d.update({...state,planting:0,bombState:'planted',bombLeft:28,defuser:0});assert.equal(h.stops.at(-1),'defuse');h.d.reset();assert.equal(h.d.round,null);
});
test('new rounds reset countdown and action state, and all audio cues exist in the asset manifest',()=>{
 const h=harness();h.d.update({...h.state,freeze:1});h.d.endRound(true);h.d.update({...h.state,round:2,freeze:5});assert.deepEqual(h.ticks,[1,5]);
 const manifest=require('../public/game/assets.json');for(const file of files)assert.ok(manifest.files.some(f=>f.name===file.name),file.name);
});
