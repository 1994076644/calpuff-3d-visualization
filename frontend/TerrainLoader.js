import * as THREE from 'three';

export async function loadTerrainData(rawUrl, metaUrl) {
    const metaRes = await fetch(metaUrl);
    if (!metaRes.ok) {
        throw new Error(`地形 meta 加载失败: ${metaUrl}`);
    }
    const terrainMeta = await metaRes.json();

    const rawRes = await fetch(rawUrl);
    if (!rawRes.ok) {
        throw new Error(`地形 raw 加载失败: ${rawUrl}`);
    }
    const rawBuffer = await rawRes.arrayBuffer();

    const expectedSize = terrainMeta.width * terrainMeta.height * 4;
    if (rawBuffer.byteLength !== expectedSize) {
        throw new Error(
            `地形 raw 文件大小不匹配：期望 ${expectedSize}，实际 ${rawBuffer.byteLength}`
        );
    }

    return {
        meta: terrainMeta,
        heights: new Float32Array(rawBuffer),
    };
}

export function createTerrainMesh(terrainData, volumeMeta, options = {}) {
    const terrainMeta = terrainData.meta;
    const heights = terrainData.heights;

    const width = terrainMeta.width;
    const height = terrainMeta.height;

    const verticalScale = options.verticalScale ?? 1.0;
    const opacity = options.opacity ?? 0.85;

    const positions = new Float32Array(width * height * 3);
    const uvs = new Float32Array(width * height * 2);
    const indices = [];

    for (let row = 0; row < height; row++) {
        for (let col = 0; col < width; col++) {
            const idx = row * width + col;

            
            const xKm = terrainMeta.x_min + (col / (width - 1)) * terrainMeta.x_length;
            const yKm = terrainMeta.y_min + (row / (height - 1)) * terrainMeta.y_length;

            
            const xObj = (xKm - volumeMeta.x_min) / volumeMeta.x_length - 0.5;
            const yObj = (yKm - volumeMeta.y_min) / volumeMeta.y_length - 0.5;

            
            const worldX = xObj;
            const worldZ = -yObj;

            
            const heightKm = heights[idx];
            const worldY = (heightKm / volumeMeta.x_length) * verticalScale;

            positions[idx * 3 + 0] = worldX;
            positions[idx * 3 + 1] = worldY;
            positions[idx * 3 + 2] = worldZ;

            uvs[idx * 2 + 0] = col / (width - 1);
            uvs[idx * 2 + 1] = row / (height - 1);
        }
    }

    for (let row = 0; row < height - 1; row++) {
        for (let col = 0; col < width - 1; col++) {
            const a = row * width + col;
            const b = row * width + col + 1;
            const c = (row + 1) * width + col;
            const d = (row + 1) * width + col + 1;

            indices.push(a, c, b);
            indices.push(b, c, d);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const material = new THREE.MeshStandardMaterial({
        color: 0x667755,
        roughness: 0.85,
        metalness: 0.0,
        side: THREE.DoubleSide,
        transparent: true,
        opacity,
        depthWrite: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'terrain_mesh';

    return mesh;
}

export async function addTerrainToScene(scene, volumeMeta, options = {}) {
    const rawUrl = options.rawUrl ?? 'http://localhost/three/terrain_uniform.raw';
    const metaUrl = options.metaUrl ?? 'http://localhost/three/terrain_uniform_meta.json';

    const terrainData = await loadTerrainData(rawUrl, metaUrl);

    console.log('地形 meta:', terrainData.meta);
    console.log(
        '地形高程范围 km:',
        terrainData.meta.elev_min,
        terrainData.meta.elev_max
    );

    const terrainMesh = createTerrainMesh(terrainData, volumeMeta, {
        verticalScale: options.verticalScale ?? 1.0,
        opacity: options.opacity ?? 0.85,
    });

    scene.add(terrainMesh);

    return terrainMesh;
    
   
}



