export const vertex = `#version 300 es
precision highp float;
void main(){
  vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`;

export const scene = `#version 300 es
precision highp float;
uniform vec2 resolution;
uniform vec3 camera;
uniform vec3 right;
uniform vec3 up;
uniform float fov;
uniform float time;
uniform float cinematic;
uniform float mobile;
uniform float falling;
uniform float panorama;
uniform vec3 observerVelocity;
uniform float diskDetail;
uniform float rayPrecision;
uniform int raySteps;
uniform vec3 forward;
uniform sampler2D paths;
uniform sampler2D endings;
out vec4 color;
const float PI=3.14159265359;
const float MAX_PHI=12.56637061436;
const float MAX_B=40.509574;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.0),f.x),f.y);}
vec2 endpoint(float b){float y=clamp(b/MAX_B*4095.0,0.0,4094.999);int j=int(y);return mix(texelFetch(endings,ivec2(j,0),0).rg,texelFetch(endings,ivec2(j+1,0),0).rg,fract(y));}
vec2 path(float b,float phi){
  vec2 p=clamp(vec2(phi/MAX_PHI*1023.0,b/MAX_B*4095.0),vec2(0),vec2(1022.999,4094.999));
  ivec2 q=ivec2(p);vec2 f=fract(p);
  return mix(mix(texelFetch(paths,q,0).rg,texelFetch(paths,q+ivec2(1,0),0).rg,f.x),
  mix(texelFetch(paths,q+ivec2(0,1),0).rg,texelFetch(paths,q+ivec2(1,1),0).rg,f.x),f.y);
}
vec3 starLayer(vec2 uv,float scale){
  vec2 p=uv*scale;vec2 cell=floor(p);vec2 f=fract(p);
  float seed=hash(cell+scale);vec2 center=vec2(hash(cell+12.3),hash(cell+67.1))*.6+.2;
  float radius=mix(.018,.10,pow(seed,16.0));
  float footprint=mix(2.0*tan(fov*.5),PI,panorama)/resolution.y;
  float aa=max(footprint*scale*.45,.006);
  float d=length(f-center);float point=1.0-smoothstep(max(0.0,radius-aa),radius+aa,d);
  float energy=radius*radius/(radius*radius+aa*aa);
  vec3 tint=mix(vec3(.52,.64,.8),vec3(.95,.84,.69),hash(cell+9.));
  return tint*point*energy*step(.975,seed)*mix(1.0,5.0,pow(seed,20.0));
}
float cloud(vec3 p){
  // Continuous on the sphere: no longitude seam in the illustrative galaxy.
  return (noise(p.xy)+noise(p.yz+17.0)+noise(p.zx+31.0))/3.0;
}
vec3 sky(vec3 d){
  vec2 uv=vec2(atan(d.z,d.x)/(2.0*PI)+.5,asin(clamp(d.y,-1.,1.))/PI+.5);
  float latitude=dot(d,normalize(vec3(.72,.22,-.65)));
  float bend=(cloud(d*12.)-.5)*.10;
  float belt=exp(-pow((latitude+bend)*5.8,2.));
  float clouds=cloud(d*18.)*.57+cloud(d*57.)*.28+cloud(d*151.)*.15;
  float dust=cloud(d*38.+vec3(cloud(d*10.)*6.));
  float river=exp(-pow((latitude+bend+(dust-.5)*.09)*23.,2.));
  float glow=belt*(.12+pow(clouds,2.0)*1.5)*(1.0-river*(.55+dust*.4));
  vec3 bg=vec3(.0015,.002,.003)+mix(vec3(.15,.16,.19),vec3(.38,.29,.21),clouds)*glow;
  return bg+starLayer(uv,130.)+starLayer(uv,320.)*.85+starLayer(uv,850.)*(.35+belt*.8);
}
vec3 diskColor(float r,float g){
  // Zero-torque thin-disk radial flux profile, in rs units, inner edge at ISCO = 3rs.
  float flux=pow(3.0/r,3.0)*max(0.0,1.0-sqrt(3.0/r));
  float temperature=pow(max(flux/.056,0.0),.25);
  float t=clamp(temperature*g,0.0,1.65);
  vec3 warm=mix(vec3(.65,.09,.008),vec3(1.0,.24,.025),smoothstep(.2,.9,t));
  warm=mix(warm,vec3(1.0,.46,.07),smoothstep(.95,1.55,t));
  vec3 physical=mix(vec3(.63,.34,.15),vec3(.82,.89,1.0),smoothstep(.4,1.05,t));
  return mix(physical,warm,cinematic);
}
float turbulence(vec2 p){
  float sum=0.0,amplitude=.52;
  mat2 turn=mat2(.8,-.6,.6,.8);
  for(int octave=0;octave<5;octave++){
    float weight=octave<3?1.0:diskDetail;
    sum+=noise(p)*amplitude*weight;
    p=turn*p*2.03+vec2(8.7,13.1);amplitude*=.48;
  }
  return sum;
}
vec3 diskEmission(vec3 position,float energy,float angularMomentum){
  float r=length(position);
  if(r<=3.0||r>=12.0)return vec3(0);
  float omega=sqrt(.5/(r*r*r));
  float g=sqrt(1.0-1.5/r)/max(.025,energy-omega*angularMomentum);
  g=min(g,8.0);
  float azimuth=atan(position.z,position.x);
  float phase=azimuth+time*omega;
  // Periodic azimuth avoids a seam; differential rotation shears these layers.
  float twist=phase+log(r/3.0)*1.7;
  vec2 plasma=vec2(cos(twist),sin(twist))*r;
  float broad=turbulence(plasma*.85);
  float warp=noise(vec2(cos(phase),sin(phase))*3.0+vec2(r*.24))-.5;
  // Long azimuthal ribbons, broken by slow eddies and radially narrow filaments.
  float bands=.5+.5*sin(r*27.0+warp*4.0+broad*12.0);
  float fine=.5+.5*sin(r*70.0+warp*9.0+broad*16.0);
  // Approximate phase-footprint filtering keeps fine bands from flickering.
  float pixelWidth=length(position-camera)*mix(2.0*tan(fov*.5),PI,panorama)/resolution.y;
  float filaments=mix(.2734,pow(bands,4.0),exp(-.5*pow(pixelWidth*27.0,2.0)));
  filaments+=mix(.1964,pow(fine,8.0),exp(-.5*pow(pixelWidth*70.0,2.0)))*diskDetail*.25;
  float spiral=.82+.18*sin(phase*9.0+log(r)*29.0+broad*2.0);
  float clumps=smoothstep(.52,.74,noise(plasma*1.9))*smoothstep(.40,.67,broad);
  float density=.28+filaments*(.7+broad)*1.35+clumps*.40;
  float flux=pow(3.0/r,3.0)*max(0.0,1.0-sqrt(3.0/r));
  float fade=smoothstep(3.0,3.15,r)*(1.0-smoothstep(10.5,12.0,r));
  float intensity=flux/.056*pow(g,4.0)*density*spiral;
  return diskColor(r,g)*intensity*fade*2.1;
}
vec3 acceleration(vec3 x,float l2){
  float r2=dot(x,x);return x*(-1.5*l2/(r2*r2*sqrt(r2)));
}
vec3 fallingView(vec3 ray){
  float radius=length(camera);vec3 er=camera/radius;
  float flow=sqrt(1.0/radius);
  float beta2=dot(observerVelocity,observerVelocity);
  float gamma=inversesqrt(max(1.0-beta2,.000001));
  float projection=dot(observerVelocity,ray);
  float omega=gamma*(1.0-projection);
  float boost=beta2>.000001?(gamma-1.0)*projection/beta2-gamma:0.0;
  vec3 spatial=ray+boost*observerVelocity;
  float energy=omega+flow*dot(spatial,er);
  // Negative Killing-energy rays in the interior have no exterior light source
  // in our collapse-inspired scene (the eternal white-hole region is omitted).
  if(energy<=0.0)return vec3(0);
  vec3 x=camera,velocity=spatial+flow*omega*er;
  vec3 momentum=cross(x,velocity);float l2=dot(momentum,momentum);
  float angularMomentum=-momentum.y;
  vec3 emission=vec3(0);float transmission=1.0;
  for(int step=0;step<800;step++){
    if(step>=raySteps)break;
    float r=length(x);
    if(r<.18)break;
    // An inward past ray below the horizon cannot turn back toward our sources.
    if(r<1.0&&dot(x,velocity)<0.0)break;
    if(r>80.0)return emission+transmission*sky(normalize(velocity))*min(4.0,pow(1.0/max(energy,.25),3.0));
    float h=clamp(rayPrecision*r/max(length(velocity),.15),.002,1.5);
    vec3 a=acceleration(x,l2);
    vec3 v2=velocity+a*h*.5, a2=acceleration(x+velocity*h*.5,l2);
    vec3 v3=velocity+a2*h*.5, a3=acceleration(x+v2*h*.5,l2);
    vec3 v4=velocity+a3*h, a4=acceleration(x+v3*h,l2);
    vec3 next=x+h/6.0*(velocity+2.0*v2+2.0*v3+v4);
    // Crossings of the thin disk are shaded in the infaller's energy frame.
    if(x.y*next.y<0.0){
      float fraction=x.y/(x.y-next.y);
      vec3 hit=mix(x,next,fraction);
      float hitR=length(hit);
      if(hitR>3.0&&hitR<12.0){emission+=transmission*diskEmission(hit,energy,angularMomentum);transmission*=.1;}
    }
    velocity+=h/6.0*(a+2.0*a2+2.0*a3+a4);x=next;
  }
  return emission;
}
void main(){
  vec2 uv=(gl_FragCoord.xy-.5*resolution)/resolution.y;
  // Keep the subject slightly left of centre to give the controls breathing room.
  uv.x+=resolution.x/resolution.y>.95?.055*(1.0-falling):0.0;
  uv.y-=mobile*.20;
  vec3 er=normalize(camera);vec3 ray=normalize(forward+(uv.x*right+uv.y*up)*2.0*tan(fov*.5));
  if(panorama>.5){
    vec2 screen=gl_FragCoord.xy/resolution;
    float longitude=(screen.x-.5)*2.0*PI,latitude=(screen.y-.5)*PI;
    ray=cos(latitude)*(cos(longitude)*forward+sin(longitude)*right)+sin(latitude)*up;
  }
  if(falling>.5){color=vec4(fallingView(ray),1);return;}
  float inward=dot(ray,-er);vec3 tangent=ray+er*inward;
  float sinAlpha=length(tangent);vec3 et=sinAlpha>.000001?tangent/sinAlpha:right;
  float b=40.0*sinAlpha/sqrt(.975);
  vec2 end=endpoint(b);vec3 outRay=er*cos(end.x)+et*sin(end.x);
  // Reject interpolation across the discontinuous capture separatrix.
  bool captured=b<2.59807621135;
  vec3 radiance=captured?vec3(0):sky(outRay);
  float phi=atan(-er.y,et.y);phi=mod(phi+PI,PI);
  float transmission=1.0;vec3 emission=vec3(0);
  for(int i=0;i<4;i++){
    float angle=phi+float(i)*PI;
    if(angle<end.x-.001){
      vec2 state=path(b,angle);float r=1.0/max(state.x,.00001);
      if(r>3.0&&r<12.0){
        vec3 position=r*(er*cos(angle)+et*sin(angle));
        float lambda=-b*cross(er,et).y;
        vec3 light=diskEmission(position,sqrt(.975),sqrt(.975)*lambda);
        emission+=transmission*light;
        transmission*=.10;
      }
    }
  }
  radiance=radiance*transmission+emission;
  // No painted photon ring: bright subimages emerge from actual disk intersections.
  color=vec4(radiance,1.0);
}`;

export const composite = `#version 300 es
precision highp float;
uniform sampler2D image;
uniform vec2 resolution;
uniform float exposure;
uniform float bloom;
out vec4 color;
vec3 sampleGlow(vec2 uv,vec2 d){vec3 c=texture(image,uv+d).rgb;return max(c-.85,0.0);}
void main(){
  vec2 uv=gl_FragCoord.xy/resolution;
  vec3 c=texture(image,uv).rgb;
  if(bloom>0.0){
    vec2 stepSize=vec2(2.5)/vec2(textureSize(image,0));vec3 glow=vec3(0);
    for(int i=0;i<8;i++){
      float a=float(i)*.785398;
      vec2 axis=vec2(cos(a),sin(a))*stepSize;
      glow+=sampleGlow(uv,axis)*.055+sampleGlow(uv,axis*3.0)*.027+sampleGlow(uv,axis*7.0)*.012;
    }
    c+=glow*bloom;
  }
  c*=exposure;
  c=(c*(2.51*c+.03))/(c*(2.43*c+.59)+.14);
  c=pow(clamp(c,0.0,1.0),vec3(1.0/2.2));
  float vignette=1.0-.19*pow(length((uv-.5)*1.2),2.0);
  color=vec4(c*vignette,1);
}`;
