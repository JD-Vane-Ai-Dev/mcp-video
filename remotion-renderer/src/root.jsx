import React from 'react';
import {AbsoluteFill, Composition, Easing, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';

const defaults={title:'Your Story, In Motion',subtitle:'Remotion video automation',brand:'YOUR BRAND',background:'#101026',accent:'#8B5CF6',ending:'Created with Remotion'};
const Promo=({title,subtitle,brand,background,accent,ending})=>{
  const frame=useCurrentFrame();
  const {durationInFrames,width}=useVideoConfig();
  const enter=interpolate(frame,[0,14],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp',easing:Easing.out(Easing.cubic)});
  const fade=interpolate(frame,[durationInFrames-16,durationInFrames-1],[1,0],{extrapolateLeft:'clamp',extrapolateRight:'clamp'});
  const vertical=width<=1080;
  return <AbsoluteFill style={{background:`radial-gradient(circle at 75% 25%, ${accent}66, transparent 45%), ${background}`,fontFamily:'Arial,Helvetica,sans-serif',color:'white',padding:vertical?72:90,boxSizing:'border-box',display:'flex',justifyContent:'center',overflow:'hidden'}}>
    <div style={{opacity:fade,transform:`translateY(${(1-enter)*60}px)`}}>
      <div style={{color:accent,letterSpacing:7,fontSize:26,fontWeight:800,marginBottom:44}}>{brand}</div>
      <div style={{fontSize:vertical?100:105,lineHeight:1.05,letterSpacing:-4,fontWeight:900,overflowWrap:'anywhere'}}>{title}</div>
      <div style={{height:9,width:160,background:accent,borderRadius:5,marginTop:50,marginBottom:37}}/>
      <div style={{fontSize:vertical?42:38,lineHeight:1.2,color:'#e2e2ef'}}>{subtitle}</div>
    </div>
    <div style={{position:'absolute',bottom:70,left:vertical?72:90,fontSize:22,opacity:.7}}>{ending}</div>
  </AbsoluteFill>;
};
const make=(id,width,height)=><Composition id={id} component={Promo} durationInFrames={90} fps={30} width={width} height={height} defaultProps={defaults}/>;
export const VideoRoot=()=> <>{make('Vertical',1080,1920)}{make('Landscape',1920,1080)}{make('Square',1080,1080)}</>;
