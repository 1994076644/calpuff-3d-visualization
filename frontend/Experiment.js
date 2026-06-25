import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GUI} from "three/addons/libs/lil-gui.module.min.js";
import { addTerrainToScene } from './TerrainLoader.js';

const vertexShader = `
precision mediump float;
uniform vec3 u_camera; 
uniform vec3 u_resolution;
uniform float u_time;
varying vec3 v_hitPos; 
varying vec3 v_hitPosWorldSpace;
varying vec3 v_cameraObjectSpace;
void main() {
  vec3 pos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  v_hitPos = position.xyz;
  v_hitPosWorldSpace = (modelMatrix * vec4(position, 1.0)).xyz;
  v_cameraObjectSpace = (inverse(modelMatrix) * vec4(u_camera, 1.0)).xyz;
  }
`;

const fragmentShader = `
precision mediump int;
precision mediump float;

uniform vec3 u_camera;
uniform vec3 u_resolution;
uniform mediump sampler3D u_volume;
uniform vec3 u_crossSectionSize;
uniform float u_dt;
uniform float u_time;
uniform float u_isoValue;
uniform float u_alphaVal;//js中传输过来的用于控制透明度平滑的值
uniform float u_maxVal;
uniform vec3 u_physSize;   // 真实物理尺寸，单位 km
uniform float u_stepPhys;  // 每一步真实走多少 km
uniform vec3 u_texelStep;   // 纹理坐标里一个体素步长
uniform vec3 u_voxelSize;   // 真实物理体素尺寸，单位 km
uniform float u_isoRange;

// ===================== 透明度方法实验相关 uniform =====================
// 0: M1 线性透明度
// 1: M2 对数透明度
// 2: M3 值-梯度二维传递函数
// 3: M4 本文方法：前向时间窗口自适应阈值 + 梯度增强
uniform int u_alphaMode;
uniform float u_tLow;
uniform float u_tHigh;
uniform float u_lambdaGrad;
uniform float u_gradLow;
uniform float u_gradHigh;
uniform float u_alphaMax;
uniform float u_logK;
uniform float u_alphaClamp;
//新增
uniform sampler2D u_terrainHeight;
uniform float u_absZMinKm;
uniform float u_absZMaxKm;
uniform float u_hagMinKm;
uniform float u_hagMaxKm;
uniform float u_xLengthKm;


varying vec3 v_hitPos;//顶点着色器传递过来的自定义坐标系的顶点坐标
varying vec3 v_hitPosWorldSpace;//顶点着色器传递过来的立方体坐标系在世界坐标系下的坐标
varying vec3 v_cameraObjectSpace;//顶点着色器传递过来的相机在自定义坐标系下的坐标

//这是一个颜色渲染函数，根据输入的0-1的值，输出一个从蓝到红的颜色
vec3 getColorFromValue(float value01) {
    value01 = clamp(value01, 0.0, 1.0);

    float startHue   = 240.0 / 360.0; // 蓝
    float endHue     = 0.0   / 360.0; // 红
    float saturation = 1.0;
    float lightness  = 0.5;

    float hue = mix(startHue, endHue, value01);

    vec3 rgb = clamp(
        abs(mod(hue * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0,
        0.0,
        1.0
    );

    rgb = rgb * rgb * (3.0 - 2.0 * rgb);

    float c = (1.0 - abs(2.0 * lightness - 1.0)) * saturation;
    return (rgb - 0.5) * c + lightness;
}

//这个函数会放回射线进入盒子的时间t0和离开盒子的时间t1
vec2 intersect_box(vec3 orig, vec3 dir) {//orig射线的起点，dir射线的方向

  vec3 box_min = vec3(-u_crossSectionSize);//盒子的左下角
  vec3 box_max = vec3(u_crossSectionSize);//盒子的右上角
  vec3 inv_dir = 1.0 / dir;//这是射线方向向量，实际上也是速度向量
  vec3 tmin_tmp = (box_min - orig) * inv_dir;//计算射线到盒子的左下角的时间
  vec3 tmax_tmp = (box_max - orig) * inv_dir;//计算设想到盒子右下角的时间
  vec3 tmin = min(tmin_tmp, tmax_tmp);//保证tmin是射线撞墙的最短时间
  vec3 tmax = max(tmin_tmp, tmax_tmp);//保证tmax是射线撞墙的最长时间
  float t0 = max(tmin.x, max(tmin.y, tmin.z));//射线进入立方体的时间，进入的时间找三个方向的最大值
  float t1 = min(tmax.x, min(tmax.y, tmax.z));//射线离开立方体的时间，出去的时间找三个方向的最小值
  return vec2(t0, t1);
}

//这是一个对象空间坐标转换到纹理空间坐标的函数
vec3 objectToTex(vec3 pObj) {//这个地方会输入当前的光线射到的位置
  return (pObj + u_crossSectionSize) / (2.0 * u_crossSectionSize);
}

//这个函数输入光线方向也就是，他会自动的根据我的步长给一个我在立方体里面应该走的距离，比如0.001km，在我的对象空间的立方体应该走的距离
float computePhysicalDt(vec3 rayDirObj) {
  vec3 objToPhys = u_physSize / (2.0 * u_crossSectionSize);
  float physPerObjUnit = length(rayDirObj * objToPhys);
  return u_stepPhys / max(physPerObjUnit, 1e-6);
}

//这个函数输入一个位置和光线方向，输出这个位置的法线
vec3 shader(vec3 p, vec3 rayDir, float dt) {
    
     float gxLess = texture(u_volume, p - vec3(rayDir.x * dt, 0.0, 0.0)).r;
     float gxMore = texture(u_volume, p + vec3(rayDir.x * dt, 0.0, 0.0)).r;

     float gyLess = texture(u_volume, p - vec3(0.0, rayDir.y * dt, 0.0)).r;
     float gyMore = texture(u_volume, p + vec3(0.0, rayDir.y * dt, 0.0)).r;

     float gzLess = texture(u_volume, p - vec3(0.0, 0.0, rayDir.z * dt)).r;
     float gzMore = texture(u_volume, p + vec3(0.0, 0.0, rayDir.z * dt)).r;

     float dgx = (gxMore - gxLess); 
     float dgy = (gyMore - gyLess); 
     float dgz = (gzMore - gzLess);

     return vec3(dgx, dgy, dgz); 
}

float mapDensity(float x) {
  x = clamp(x, 0.0, 1.0);
  float xCompress = asinh(6.0 * x) / asinh(6.0);
  float xLift = pow(xCompress, 0.65);

  return xLift;
}//对纹理值进行处理压低高值，提升低值，让颜色映射更好看一些

// 对数归一化：压缩浓度动态范围，增强低浓度区域
float logMapDensity(float x) {
  x = clamp(x, 0.0, 1.0);
  return log(1.0 + u_logK * x) / log(1.0 + u_logK);
}

// 所有方法共用相同的指数吸收模型，保证对比时只改变“透明度映射函数”
float absorptionAlpha(float opticalDensity) {
  opticalDensity = clamp(opticalDensity, 0.0, 1.0);
  float alpha = 1.0 - exp(-3.0 * u_alphaVal * opticalDensity * u_stepPhys);
  return clamp(alpha, 0.0, u_alphaClamp);
}

// 这个函数是 M1~M4 的透明度方法入口
float computeVolumeAlpha(float textureVal, float gradMag) {
  float c = clamp(textureVal, 0.0, 1.0);
  float logC = logMapDensity(c);
  float gradW = smoothstep(u_gradLow, u_gradHigh, gradMag);

  float opticalDensity = c;//这里的这个透明度值是从浓度中clamp中获得的

  if (u_alphaMode == 0) {
    // M1：线性透明度
    opticalDensity = c;
  } else if (u_alphaMode == 1) {
    // M2：对数透明度
    opticalDensity = logC;
  } else if (u_alphaMode == 2) {
    // M3：值-梯度二维传递函数
    opticalDensity = logC * (1.0 + u_lambdaGrad * gradW);//u_lambdaGrad是梯度增强项
  } else {
    // M4：本文方法，前向时间窗口自适应阈值 + 梯度增强
    opticalDensity = smoothstep(u_tLow, u_tHigh, logC);
    opticalDensity = opticalDensity * (1.0 + u_lambdaGrad * gradW) * u_alphaMax;
  }

  return absorptionAlpha(opticalDensity);
}

// 返回当前沿射线方向前进一步，在纹理空间中的步进长度
// 计算当前主步进在纹理坐标空间里的长度（标量）
float computePhysicalDtTexLength(vec3 rayDirObj) {
    float dtObj = computePhysicalDt(rayDirObj);
    vec3 stepTex = (rayDirObj * dtObj) / (2.0 * u_crossSectionSize);
    return length(stepTex);
}


void main() {
  vec3 rayOrigin = vec3(0.0, 0.0, -3.0);//固定的射线源
  rayOrigin = v_cameraObjectSpace;//相机在自定义坐标系下的坐标

  vec2 uv = 2.0 * gl_FragCoord.xy / u_resolution.xy - 1.0;//归一化坐标到[-1,1]
  vec3 rayDir = normalize(vec3(uv, 1.0));//这里就是射线方向，这里加1实际上就是指定为永远朝着z方向的某个像素移动
  rayDir = normalize(v_hitPos - rayOrigin);//在自定义坐标系下通过立方体的坐标减去射线源，得到射线方向，这里的v_hitPos已经是光栅化后的像素

  vec2 t_hit = intersect_box(rayOrigin, rayDir);
  if (t_hit.x > t_hit.y) {//intersect_box返回t_hit.x是进入的时间，t_hit.y是离开的时间，进入的时间比离开的时间还大就说明，这射线就没撞击到盒子
    discard;
  }

  t_hit.x = max(t_hit.x, 0.0);//如果相机进入了盒子，算出来射线进入盒子的时间就是负数了，这是保证就算相机进入盒子，也只看前面的东西

 float dt = computePhysicalDt(rayDir);//这里获得我走1m我的立方体里面走多少的距离
 float stepTex = computePhysicalDtTexLength(rayDir);//这里获得我走1m在纹理空间里面应该走多少的距离
vec4 color = vec4(0.0);//这是一个颜色积累的初始化的值

// 保留对象坐标，不再直接 +0.5
vec3 pObj = rayOrigin + t_hit.x * rayDir;//射线源头加上射线方向乘上时间得到当前步进距离

for (float t = t_hit.x; t < t_hit.y; t += dt) {//这里对时间进行循环

   vec3 p = objectToTex(pObj);//把对象空间的立方体的坐标转换到纹理坐标系

  float textureVal = texture(u_volume, p).r;


   // 先计算梯度，再把梯度传给透明度函数。这样 M3/M4 可以使用边界增强。
   vec3 gradVec = shader(p, rayDir, stepTex);
   float gradMag = length(gradVec);

   // 根据纹理值和梯度计算当前方法下的透明度
   float val_color_alpha = computeVolumeAlpha(textureVal, gradMag);

   //根据纹理值得到一个颜色
   vec3 baseRgb = getColorFromValue(textureVal);//根据纹理值得到一个颜色

   //获得阈值范围内的一个平滑的边界值
   float surfaceMask = smoothstep(u_isoValue - u_isoRange,u_isoValue + u_isoRange,textureVal);//采用软阈值，让边界更平滑一些 
  

   vec3 sampleRgb = baseRgb;
   if (gradMag >  1e-6) {
     vec3 n = normalize(gradVec);
        if (dot(n, rayDir) > 0.0) {
            n = -n;
    }

     vec3 lightSource = vec3(1.0);//光源方向
     vec3 lightDir = normalize(lightSource);//平行光方向
     float diffuseStrength = max(dot(n, lightDir), 0.0);//计算漫反射

     vec3 viewSource = normalize(rayOrigin - pObj);//相机方向-当前光线
     vec3 reflectSource = normalize(reflect(-lightDir, n));//计算反射方向
     float specularStrength = max(0.0, dot(viewSource, reflectSource));//计算镜面高光
     specularStrength = pow(specularStrength, 32.0);

     //通过法线长度计算一个权重，让法线越明显的地方，颜色越亮一些
     float gradWeight = smoothstep(0.02, 0.12, gradMag);

     //计算表面光照颜色
     vec3 litRgb = baseRgb * (0.25 + 0.75 * diffuseStrength) + 0.12 * specularStrength * vec3(1.0);

     // 用法线长度和是否是纹理边缘值计算一个光线权重
     float lightWeight = surfaceMask * gradWeight;

     //将纹理映射出的本身的颜色和计算的表面光照颜色通过光线权重进行线性的插值
     sampleRgb = mix(baseRgb, litRgb, lightWeight);
    }
    color.rgb += (1.0 - color.a) * val_color_alpha * sampleRgb;
    color.a   += (1.0 - color.a) * val_color_alpha;
  

  if (color.a >= 0.95) {
    break;
  }

  pObj += rayDir * dt;
}


gl_FragColor = color;
}
`;



//初始化场景
const scene = new THREE.Scene();
//scene.background = new THREE.Color(0x111111);
scene.background = null;
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0.48, 0.36, -0.72);
camera.lookAt(new THREE.Vector3(0, 0, 0));


const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true,alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);


const controls = new OrbitControls(camera, renderer.domElement);



controls.minDistance = 0.35;
controls.maxDistance = 4.0;
controls.update();

        
// scene.add(new THREE.AxesHelper(1));
//给地形添加光照
scene.add(new THREE.AmbientLight(0xffffff, 0.65));
const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
dirLight.position.set(1, 2, 1);
scene.add(dirLight);

let rawBuffer;
let meta;


const SRC_X_KM = 502.521;
const SRC_Y_KM = 4477.150;

const ALPHA_METHODS = {
  'M1 线性透明度': 0,
  'M2 对数透明度': 1,
  'M3 值-梯度二维传递函数': 2,
  'M4 本文方法': 3,
};

const METHOD_NAMES = [
  'M1 线性透明度',
  'M2 对数透明度',
  'M3 值-梯度二维传递函数',
  'M4 本文方法'
];

const LOG_K = 12.0;

const M4_WINDOW_SIZE = 5;//前向时间窗口长度，取当前分钟及其后续 windowSize-1 个时刻
const MAX_MINUTE = 120;//这里是最大时间，防止超过时间报错

function getForwardWindowMinutes(currentMinute, windowSize) {
  const minutes = [];
  const endMinute = Math.min(MAX_MINUTE + 1, currentMinute + windowSize);

  for (let m = currentMinute; m < endMinute; m++) {
    minutes.push(m);
  }

  return minutes;
}

function clamp01(v) {
  return Math.min(1.0, Math.max(0.0, v));
}

function smoothstepJS(edge0, edge1, x) {
  const denom = Math.max(edge1 - edge0, 1e-6);
  const t = clamp01((x - edge0) / denom);
  return t * t * (3.0 - 2.0 * t);
}

function logMapJS(v, logK = LOG_K) {
  const x = clamp01(v);
  return Math.log(1.0 + logK * x) / Math.log(1.0 + logK);
}

function quantileSorted(sorted, q) {
  if (!sorted.length) return 0.0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = Math.min(base + 1, sorted.length - 1);
  return sorted[base] * (1.0 - rest) + sorted[next] * rest;
}

function computeFrameAlphaStats(volumeData) {
  const vals = [];
  for (let i = 0; i < volumeData.length; i++) {
    const v = volumeData[i];
    if (Number.isFinite(v) && v > 0.0) vals.push(logMapJS(v));
  }
  vals.sort((a, b) => a - b);

  
  return {
    tLow: quantileSorted(vals, 0.05),
    tHigh: quantileSorted(vals, 0.95),
  };
}

async function computeWindowAlphaStats(minutes) {
  const vals = [];

  for (const minute of minutes) {
    try {
      const item = await loadVolumeForMinute(minute);
      const volumeData = item.volumeData;

      for (let i = 0; i < volumeData.length; i++) {
        const v = volumeData[i];
        if (Number.isFinite(v) && v > 0.0) {
          vals.push(logMapJS(v));
        }
      }
    } catch (e) {
      console.warn(`M4 时间窗口跳过第 ${minute} 分钟：`, e);
    }
  }

  vals.sort((a, b) => a - b);

  if (!vals.length) {
    return {
      tLow: 0.08,
      tHigh: 0.95,
    };
  }

  return {
    tLow: quantileSorted(vals, 0.05),//取5% 分位数作为低值
    tHigh: quantileSorted(vals, 0.95),//取95% 分位数作为高值
  };
}

function computeGradientArray(data, width, height, depth) {
  const grad = new Float32Array(data.length);
  const sliceSize = width * height;
  const idx = (x, y, z) => z * sliceSize + y * width + x;

  for (let z = 0; z < depth; z++) {
    const z0 = Math.max(0, z - 1);
    const z1 = Math.min(depth - 1, z + 1);
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - 1);
      const y1 = Math.min(height - 1, y + 1);
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - 1);
        const x1 = Math.min(width - 1, x + 1);
        const gx = data[idx(x1, y, z)] - data[idx(x0, y, z)];
        const gy = data[idx(x, y1, z)] - data[idx(x, y0, z)];
        const gz = data[idx(x, y, z1)] - data[idx(x, y, z0)];
        grad[idx(x, y, z)] = Math.sqrt(gx * gx + gy * gy + gz * gz);
      }
    }
  }
  return grad;
}

function opticalDensityForMethod(mode, cRaw, gradMag, frameStats, params = {}) {
  const c = clamp01(cRaw);
  const logC = logMapJS(c, params.logK ?? LOG_K);
  const gradLow = params.gradLow ?? 0.02;
  const gradHigh = params.gradHigh ?? 0.12;
  const lambdaGrad = params.lambdaGrad ?? 0.6;
  const alphaMax = params.alphaMax ?? 1.0;
  const gradW = smoothstepJS(gradLow, gradHigh, gradMag);

  if (mode === 0) return c;
  if (mode === 1) return logC;
  if (mode === 2) return clamp01(logC * (1.0 + lambdaGrad * gradW));
  return clamp01(smoothstepJS(frameStats.tLow, frameStats.tHigh, logC) * (1.0 + lambdaGrad * gradW) * alphaMax);
}

function computePollutionMetrics(volumeData, meta, targetDepth, params = {}) {
  const width = meta.width;
  const height = meta.height;
  const depth = targetDepth;
  const sliceSize = width * height;

  const dx = meta.x_length / Math.max(width - 1, 1);
  const dy = meta.y_length / Math.max(height - 1, 1);
  const dz = meta.z_length / Math.max(depth - 1, 1);

  const cellVolume = dx * dy * dz; // km^3
  const cellArea = dx * dy;        // km^2
  const cThreshold = params.concentrationThreshold ?? 0.05;

  let exceedVoxelCount = 0;
  let affectedCellCount = 0;
  let dMax = 0.0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let affected = false;

      for (let z = 0; z < depth; z++) {
        const idx = z * sliceSize + y * width + x;
        const c = volumeData[idx];

        if (Number.isFinite(c) && c >= cThreshold) {
          exceedVoxelCount++;
          affected = true;
        }
      }

      if (affected) {
        affectedCellCount++;
        const xKm = meta.x_min + x * dx;
        const yKm = meta.y_min + y * dy;
        const d = Math.sqrt((xKm - SRC_X_KM) ** 2 + (yKm - SRC_Y_KM) ** 2);
        dMax = Math.max(dMax, d);
      }
    }
  }

  return {
    V_exceed_km3: exceedVoxelCount * cellVolume,
    A_exceed_km2: affectedCellCount * cellArea,
    D_max_km: dMax,
    exceed_voxels: exceedVoxelCount,
    affected_xy_cells: affectedCellCount,
  };
}

// ===================== 三维污染场地面投影 =====================

function computeGroundRiskProjection(volumeData, meta, targetDepth, params = {}) {
  const width = meta.width;
  const height = meta.height;
  const depth = targetDepth;
  const sliceSize = width * height;

  const dx = meta.x_length / Math.max(width - 1, 1);
  const dy = meta.y_length / Math.max(height - 1, 1);

  const cThreshold = params.concentrationThreshold ?? 0.05;
  const mode = params.projectionMode ?? 'max';

  // 每个地面网格的投影浓度
  const cProj = new Float32Array(width * height);

  // 是否属于地面影响范围
  const riskMask = new Uint8Array(width * height);

  // 是否为边界网格
  const boundaryMask = new Uint8Array(width * height);

  let affectedCellCount = 0;
  let boundaryCellCount = 0;
  let dMax = 0.0;

  const idx2D = (x, y) => y * width + x;
  const idx3D = (x, y, z) => z * sliceSize + y * width + x;

  // 1. 计算地面投影浓度 C_proj(x,y)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let cValue = 0.0;

      if (mode === 'ground') {
        // 只取最底层，z = 0
        cValue = volumeData[idx3D(x, y, 0)];
      } else {
        // 垂直最大浓度投影：max_z C(x,y,z)
        let maxC = 0.0;
        for (let z = 0; z < depth; z++) {
          const c = volumeData[idx3D(x, y, z)];
          if (Number.isFinite(c)) {
            maxC = Math.max(maxC, c);
          }
        }
        cValue = maxC;
      }

      const id = idx2D(x, y);
      cProj[id] = Number.isFinite(cValue) ? cValue : 0.0;

      if (cProj[id] >= cThreshold) {
        riskMask[id] = 1;
        affectedCellCount++;

        const xKm = meta.x_min + x * dx;
        const yKm = meta.y_min + y * dy;
        const d = Math.sqrt((xKm - SRC_X_KM) ** 2 + (yKm - SRC_Y_KM) ** 2);
        dMax = Math.max(dMax, d);
      }
    }
  }

  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = idx2D(x, y);
      if (riskMask[id] === 0) continue;

      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ];

      let isBoundary = false;

      for (const [nx, ny] of neighbors) {
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) {
          isBoundary = true;
          break;
        }

        if (riskMask[idx2D(nx, ny)] === 0) {
          isBoundary = true;
          break;
        }
      }

      if (isBoundary) {
        boundaryMask[id] = 1;
        boundaryCellCount++;
      }
    }
  }

  return {
    width,
    height,
    dx,
    dy,
    cThreshold,
    projectionMode: mode,

    cProj,
    riskMask,
    boundaryMask,

    A_exceed_km2: affectedCellCount * dx * dy,
    D_max_km: dMax,
    affectedCellCount,
    boundaryCellCount,
  };
}

function downloadGroundProjectionCsv(filename, projection, meta) {
  const {
    width,
    height,
    dx,
    dy,
    cThreshold,
    projectionMode,
    cProj,
    riskMask,
    boundaryMask,
    A_exceed_km2,
    D_max_km,
  } = projection;

  const header = [
    'x_index',
    'y_index',
    'x_km',
    'y_km',
    'x_m',
    'y_m',
    'c_proj_norm',
    'c_proj_real_est',
    'risk_mask',
    'boundary_mask',
    'threshold_norm',
    'projection_mode',
    'A_exceed_km2',
    'D_max_km',
  ];

  const rows = [header.join(',')];

  const localMax = meta.local_max_val ?? 1.0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const id = y * width + x;

      const xKm = meta.x_min + x * dx;
      const yKm = meta.y_min + y * dy;
      const xM = xKm * 1000.0;
      const yM = yKm * 1000.0;


      const cNorm = cProj[id];
      const cRealEst = cNorm * localMax;

      rows.push([
        x,
        y,
        xKm,
        yKm,
        xM,
        yM,
        cNorm,
        cRealEst,
        riskMask[id],
        boundaryMask[id],
        cThreshold,
        projectionMode,
        A_exceed_km2,
        D_max_km,
      ].join(','));
    }
  }

  const csv = rows.join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');

  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function evaluateAlphaAndPollutionMetrics(volumeData, meta, targetDepth, frameStats, minute, params = {}) {
  const width = meta.width;
  const height = meta.height;
  const depth = targetDepth;
  const grad = computeGradientArray(volumeData, width, height, depth);

  const gradVals = [];
  for (let i = 0; i < grad.length; i++) {
    if (volumeData[i] > 0.0) gradVals.push(grad[i]);
  }
  gradVals.sort((a, b) => a - b);
  const edgeThreshold = quantileSorted(gradVals, 0.80);

  const concentrationThreshold = params.concentrationThreshold ?? 0.05;
  const visibleThreshold = params.visibleThreshold ?? 0.01;
  const saturationThreshold = params.saturationThreshold ?? 0.80;

  const pollutionMetrics = computePollutionMetrics(volumeData, meta, targetDepth, params);
  const rows = [];

  for (let mode = 0; mode < METHOD_NAMES.length; mode++) {
    let nonzero = 0;
    let visible = 0;
    let saturated = 0;
    let sumOpacity = 0;
    let edgeSum = 0;
    let edgeN = 0;
    let innerSum = 0;
    let innerN = 0;

    
    let inter = 0;
    let union = 0;

    for (let i = 0; i < volumeData.length; i++) {
      const c = volumeData[i];
      if (!Number.isFinite(c)) continue;

      const od = opticalDensityForMethod(mode, c, grad[i], frameStats, params);
      const maskC = c >= concentrationThreshold;
      const maskAlpha = od >= visibleThreshold;

      if (maskC && maskAlpha) inter++;
      if (maskC || maskAlpha) union++;

      if (c <= 0.0) continue;
      nonzero++;
      sumOpacity += od;

      if (od > visibleThreshold) visible++;
      if (od > saturationThreshold) saturated++;

      if (grad[i] >= edgeThreshold) {
        edgeSum += od;
        edgeN++;
      } else {
        innerSum += od;
        innerN++;
      }
    }

    const edgeMean = edgeSum / Math.max(edgeN, 1);
    const innerMean = innerSum / Math.max(innerN, 1);

    rows.push({
      minute,
      method: METHOD_NAMES[mode],
      visible_ratio: visible / Math.max(nonzero, 1),
      saturated_ratio: saturated / Math.max(nonzero, 1),
      edge_enhancement_ratio: edgeMean / Math.max(innerMean, 1e-6),
      mean_opacity: sumOpacity / Math.max(nonzero, 1),

      V_exceed_km3: pollutionMetrics.V_exceed_km3,
      A_exceed_km2: pollutionMetrics.A_exceed_km2,
      D_max_km: pollutionMetrics.D_max_km,
      IoU: inter / Math.max(union, 1),

      nonzero_voxels: nonzero,
      exceed_voxels: pollutionMetrics.exceed_voxels,
      affected_xy_cells: pollutionMetrics.affected_xy_cells,
      concentration_threshold: concentrationThreshold,
      visible_threshold: visibleThreshold,
      tLow: frameStats.tLow,
      tHigh: frameStats.tHigh,
    });
  }

  return rows;
}

function downloadCsv(filename, rows) {
  if (!rows.length) return;
  const header = Object.keys(rows[0]);
  const csv = [
    header.join(','),
    ...rows.map(r => header.map(k => JSON.stringify(r[k] ?? '')).join(','))
  ].join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function loadVolumeForMinute(minute) {
  const metaUrl = `http://localhost/three/3D_Matrix_${minute}min_uniformZ_meta.json`;
  const rawUrl = `http://localhost/three/3D_Matrix_${minute}min_uniformZ.raw`;

  const metaRes = await fetch(metaUrl);
  const m = await metaRes.json();
  const rawRes = await fetch(rawUrl);
  const buf = await rawRes.arrayBuffer();
  const expectedSize = m.width * m.height * m.depth * 4;

  if (buf.byteLength !== expectedSize) {
    throw new Error(`第 ${minute} 分钟文件大小不匹配：期望 ${expectedSize}, 实际 ${buf.byteLength}`);
  }

  const data = new Float32Array(buf);
  const targetDepth = USE_Z_INTERP ? 90 : m.depth;
  const volumeData = USE_Z_INTERP
    ? interpolateZLinear(data, m.width, m.height, m.depth, targetDepth)
    : data;

  return { meta: m, volumeData, targetDepth };
}

async function evaluateBatchAlphaAndPollutionMetrics(minutes, params = {}) {
  const allRows = [];
  for (const minute of minutes) {
    const item = await loadVolumeForMinute(minute);

    // M4 使用当前 minute 开始的前向时间窗口
    const m4WindowMinutes = getForwardWindowMinutes(minute, M4_WINDOW_SIZE);
    const frameStats = await computeWindowAlphaStats(m4WindowMinutes);

    const rows = evaluateAlphaAndPollutionMetrics(
      item.volumeData,
      item.meta,
      item.targetDepth,
      frameStats,
      minute,
      params
    );

    allRows.push(...rows);
  }

  console.table(allRows);
  downloadCsv('alpha_pollution_metrics_all_minutes.csv', allRows);
}

function saveScreenshot(renderer, minute, methodName) {
  const safeName = methodName.replace(/\s+/g, '_').replace(/[\\/:*?"<>|]/g, '');
  const a = document.createElement('a');
  a.href = renderer.domElement.toDataURL('image/png');
  a.download = `minute_${minute}_${safeName}.png`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}



//画出污染原点
function geoToVolumeLocal(xKm, yKm, zKm, meta) {
  const tx = (xKm - meta.x_min) / (meta.x_max - meta.x_min);
  const ty = (yKm - meta.y_min) / (meta.y_max - meta.y_min);
  const tz = (zKm - meta.z_min) / (meta.z_max - meta.z_min);

  return new THREE.Vector3(
    tx - 0.5,
    ty - 0.5,
    tz - 0.5
  );
}

function addSourceMarkerToScene(scene, volumeMesh, meta) {
  // 污染源平面坐标，单位 km
  const srcX = 502.521;
  const srcY = 4477.150;

  // 推荐用真实地表高程 335.9 m + 烟囱高度 5 m
  // 如果你想按当前 point.txt 的 350.9 + 5，则改成 350.9 + 5.0
  const srcGroundM = 335.9;
  const stackHeightM = 5.0;
  const srcZ = (srcGroundM + stackHeightM) / 1000.0; // km

  const localPos = geoToVolumeLocal(srcX, srcY, srcZ, meta);

  // 把浓度体局部坐标转换到世界坐标
  volumeMesh.updateMatrixWorld(true);
  const worldPos = volumeMesh.localToWorld(localPos.clone());

  // 红色小球
  const ballsize = 0.0045//污染源点球的大小
  const markerGeo = new THREE.SphereGeometry(ballsize, 32, 32);
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0xff0000,
    depthTest: false,
    depthWrite: false
  });

  const marker = new THREE.Mesh(markerGeo, markerMat);
  marker.position.copy(worldPos);
  marker.renderOrder = 999;
  marker.frustumCulled = false;
  scene.add(marker);

 

  // 每帧让圆环朝向相机
  return { marker };
}

async function init(minute) {
            try {
        // 动态拼接名字，比如 1min, 2min
            const metaUrl = `http://localhost/three/3D_Matrix_${minute}min_uniformZ_meta.json`;
            const rawUrl = `http://localhost/three/3D_Matrix_${minute}min_uniformZ.raw`;
           

            // 1. 获取专属 JSON 配置
            const metaRes = await fetch(metaUrl);
            const meta = await metaRes.json();
            
            // 2. 获取 RAW 数据
            const rawRes = await fetch(rawUrl);
            const rawBuffer = await rawRes.arrayBuffer();
            
            // 3. 完美的安全校验
            const expectedSize = meta.width * meta.height * meta.depth * 4;
            if (rawBuffer.byteLength !== expectedSize) {
                throw new Error(`文件大小不匹配! 期望 ${expectedSize}, 实际 ${rawBuffer.byteLength}`);
            }
        
            // 4. 解析为 3D 纹理并更新材质
           
            // ... 此处生成 THREE.Data3DTexture ...
           const data = new Float32Array(rawBuffer);

           const targetDepth = USE_Z_INTERP ? 90 : meta.depth;

           const volumeData = USE_Z_INTERP
              ? interpolateZLinear(
                  data,
                  meta.width,
                  meta.height,
                  meta.depth,
                  targetDepth
                )
              : data;

             // M4 使用前向时间窗口阈值
            const m4WindowMinutes = getForwardWindowMinutes(minute, M4_WINDOW_SIZE);
            console.log('M4 时间窗口：', m4WindowMinutes);

            const frameAlphaStats = await computeWindowAlphaStats(m4WindowMinutes);

             const texture = new THREE.Data3DTexture(
              volumeData,
              meta.width,
              meta.height,
              targetDepth
             );

             texture.format = THREE.RedFormat;
             texture.type = THREE.FloatType;

             if (DEBUG_RAW_VIEW) {
               texture.minFilter = THREE.NearestFilter;
               texture.magFilter = THREE.NearestFilter;
             } else {
               texture.minFilter = THREE.LinearFilter;
               texture.magFilter = THREE.LinearFilter;
             }

             texture.unpackAlignment = 1;
             texture.needsUpdate = true;

             document.getElementById('info').innerText =
              `当前进度：第 ${minute} 分钟 | 原始层数：${meta.depth} | 当前层数：${targetDepth} | 区域最高浓度：${meta.local_max_val.toExponential(4)}`;
            //添加一个gui
            const width = window.innerWidth;
            const height = window.innerHeight;
            const dxPhys = meta.x_length / (meta.width - 1);
            const dyPhys = meta.y_length / (meta.height - 1);
            const dzPhys = meta.z_length / (targetDepth - 1);
            const gui = new GUI();
            const folder = gui.addFolder('设置');
            folder.open();
            const crossFolder = folder.addFolder('立方体的大小设置');
            const crossSectionSize = new THREE.Vector3(0.5, 0.5, 0.5);
            crossFolder.add(crossSectionSize, 'x', 0.02, 0.5, 0.02);
            crossFolder.add(crossSectionSize, 'y', 0.02, 0.5, 0.02);
            crossFolder.add(crossSectionSize, 'z', 0.02, 0.5, 0.02);
            crossFolder.open();
            //这里是gui的设置
                const uniforms = {
                u_camera: {
                  value: camera.position,
                },
                u_resolution: {
                  value: new THREE.Vector3(width, height, 1),
                },
                u_time: {
                  value: 0.0,
                },
                u_crossSectionSize: {
                  value: crossSectionSize,
                },
                u_volume: {
                  value: texture,
                },
                u_isoValue: {
                  value: 0.5,
                },
                u_alphaVal: {
                  value: 1,
                },
                u_maxVal: { value: meta.local_max_val }, // 从 JSON 来的真实最大浓度
                 u_physSize: {
                  value: new THREE.Vector3(meta.x_length, meta.y_length, meta.z_length),
                },
                u_stepPhys: {
                  value: 0.008,
                },
                u_texelStep: {
                value: new THREE.Vector3(
                  1.0 / (meta.width - 1),
                  1.0 / (meta.height - 1),
                  1.0 / (targetDepth - 1)
                ),
              },
              u_voxelSize: {
                value: new THREE.Vector3(dxPhys, dyPhys, dzPhys),
              },
              u_isoRange: {
                value: 0.05,
              },
              u_alphaMode: { value: 3 },
              u_tLow: { value: frameAlphaStats.tLow },
              u_tHigh: { value: frameAlphaStats.tHigh },
              u_lambdaGrad: { value: 0.6 },
              u_gradLow: { value: 0.02 },
              u_gradHigh: { value: 0.12 },
              u_alphaMax: { value: 1.0 },
              u_logK: { value: LOG_K },
              u_alphaClamp: { value: 0.25 },
             
            };
            const algoFolder = folder.addFolder('算法的设置');
            algoFolder.add(uniforms.u_stepPhys, 'value', 0.002, 0.03, 0.001).name('物理步长(km)');
            const alphaSetting = algoFolder
                .add(uniforms.u_alphaVal, 'value', 0.01, 1, 0.01)
                .name('透明度');

            const experimentParams = {
              alphaMethod: 'M4 本文方法',
              concentrationThreshold: 0.05, 
              visibleThreshold: 0.01,
              saturationThreshold: 0.80,

              导出当前帧指标CSV: () => {
                const rows = evaluateAlphaAndPollutionMetrics(
                  volumeData,
                  meta,
                  targetDepth,
                  {
                  tLow: uniforms.u_tLow.value,
                  tHigh: uniforms.u_tHigh.value,
                  },
                  minute,
                  {
                    logK: uniforms.u_logK.value,
                    gradLow: uniforms.u_gradLow.value,
                    gradHigh: uniforms.u_gradHigh.value,
                    lambdaGrad: uniforms.u_lambdaGrad.value,
                    alphaMax: uniforms.u_alphaMax.value,
                    concentrationThreshold: experimentParams.concentrationThreshold,
                    visibleThreshold: experimentParams.visibleThreshold,
                    saturationThreshold: experimentParams.saturationThreshold,
                  }
                );
                console.table(rows);
                downloadCsv(`alpha_pollution_metrics_${minute}min.csv`, rows);
              },

              导出全部实验指标CSV: () => {
                evaluateBatchAlphaAndPollutionMetrics(EXPERIMENT_MINUTES, {
                  logK: uniforms.u_logK.value,
                  gradLow: uniforms.u_gradLow.value,
                  gradHigh: uniforms.u_gradHigh.value,
                  lambdaGrad: uniforms.u_lambdaGrad.value,
                  alphaMax: uniforms.u_alphaMax.value,
                  concentrationThreshold: experimentParams.concentrationThreshold,
                  visibleThreshold: experimentParams.visibleThreshold,
                  saturationThreshold: experimentParams.saturationThreshold,
                });
              },

              保存当前截图: () => {
                saveScreenshot(renderer, minute, experimentParams.alphaMethod);
              },
              导出地面投影CSV: () => {
              const projection = computeGroundRiskProjection(
                volumeData,
                meta,
                targetDepth,
                {
                  concentrationThreshold: experimentParams.concentrationThreshold,
                  projectionMode: 'max',
                }
              );

              console.log('地面投影结果：', {
                A_exceed_km2: projection.A_exceed_km2,
                D_max_km: projection.D_max_km,
                affectedCellCount: projection.affectedCellCount,
                boundaryCellCount: projection.boundaryCellCount,
                threshold: projection.cThreshold,
                mode: projection.projectionMode,
              });

              downloadGroundProjectionCsv(
                `ground_projection_${minute}min.csv`,
                projection,
                meta
              );
            },
            };

            algoFolder
              .add(experimentParams, 'alphaMethod', Object.keys(ALPHA_METHODS))
              .name('透明度方法')
              .onChange((name) => {
                uniforms.u_alphaMode.value = ALPHA_METHODS[name];
              });

            algoFolder.add(experimentParams, 'concentrationThreshold', 0.001, 0.5, 0.001).name('污染阈值Cth');
            algoFolder.add(experimentParams, 'visibleThreshold', 0.001, 0.5, 0.001).name('可见阈值alpha');
            algoFolder.add(experimentParams, 'saturationThreshold', 0.1, 1.0, 0.01).name('饱和阈值');
            algoFolder.add(uniforms.u_tLow, 'value', 0, 1, 0.01).name('M4窗口低阈值');
            algoFolder.add(uniforms.u_tHigh, 'value', 0, 1, 0.01).name('M4窗口高阈值');
            algoFolder.add(uniforms.u_lambdaGrad, 'value', 0, 2, 0.05).name('梯度增强λ');
            algoFolder.add(uniforms.u_gradLow, 'value', 0, 0.3, 0.005).name('梯度低阈值');
            algoFolder.add(uniforms.u_gradHigh, 'value', 0, 0.5, 0.005).name('梯度高阈值');
            algoFolder.add(uniforms.u_alphaMax, 'value', 0.1, 2.0, 0.05).name('本文αmax');
            algoFolder.add(uniforms.u_logK, 'value', 1, 50, 1).name('对数系数K');
            algoFolder.add(uniforms.u_alphaClamp, 'value', 0.05, 0.5, 0.01).name('单步alpha上限');
            algoFolder.add(experimentParams, '导出当前帧指标CSV').name('导出当前帧指标CSV');
            algoFolder.add(experimentParams, '导出地面投影CSV').name('导出地面投影CSV');
            algoFolder.add(experimentParams, '导出全部实验指标CSV').name('导出全部实验指标CSV');
            algoFolder.add(experimentParams, '保存当前截图').name('保存当前截图');
            algoFolder.open();
            
            //立方体的创建和材质的设置
            const geometry = new THREE.BoxGeometry(1, 1, 1);
            const material = new THREE.ShaderMaterial({
                fragmentShader: fragmentShader,
                vertexShader: vertexShader,
                uniforms: {...uniforms},
                side: THREE.BackSide,
                transparent: true,
                depthWrite: false,

            });
            const mesh = new THREE.Mesh(geometry, material);//把材料和里几何体当作mesh使用
            const zScale = meta.z_length / meta.x_length
            const zBottom = meta.z_min / meta.x_length;
            const centerOffset = zBottom + 0.5 * zScale;
            mesh.scale.set(1, 1, zScale);
            mesh.rotation.x = -Math.PI / 2;
            mesh.position.y = centerOffset
            scene.add(mesh);
            // 添加污染源标记
            const sourceMarker = addSourceMarkerToScene(scene, mesh, meta);
            // 调用添加地形的函数
            await addTerrainToScene(scene, meta, {
            rawUrl: 'http://localhost/three/terrain_uniform.raw',
            metaUrl: 'http://localhost/three/terrain_uniform_meta.json',
            verticalScale: 1.0,
            opacity: 0.6,
        });


       
        function render() {
        material.uniforms.u_camera.value.copy(camera.position);
        controls.update();
        renderer.render(scene, camera);
        requestAnimationFrame(render);
        }
        render();
        }
        catch (err) {
                console.error(err);
                return;
            }
        }
        function interpolateZLinear(data, width, height, depth, newDepth) {
            if (newDepth === depth) return data;

            const out = new Float32Array(width * height * newDepth);
            const sliceSize = width * height;

            for (let zNew = 0; zNew < newDepth; zNew++) {
              const zOld = (zNew * (depth - 1)) / (newDepth - 1);

              const z0 = Math.floor(zOld);
              const z1 = Math.min(z0 + 1, depth - 1);
              const t = zOld - z0;

              const base0 = z0 * sliceSize;
              const base1 = z1 * sliceSize;
              const baseOut = zNew * sliceSize;

              for (let i = 0; i < sliceSize; i++) {
                const v0 = data[base0 + i];
                const v1 = data[base1 + i];
                out[baseOut + i] = v0 * (1.0 - t) + v1 * t;
              }
            }

            return out;
}
        const DEBUG_RAW_VIEW = false;     
        const USE_Z_INTERP = false;      

        // 当前页面显示哪一分钟
        const DISPLAY_MINUTE = 50;


        const EXPERIMENT_MINUTES = [40,50,60];//批量实验统计时间

        async function main() {
          init(DISPLAY_MINUTE);
        }

        main();