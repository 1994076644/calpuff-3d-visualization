
# CALPUFF 3D Visualization Frontend

This repository provides the frontend visualization code used for CALPUFF-based 3D air pollution dispersion visualization over complex terrain.

The project implements Three.js-based volume rendering, opacity mapping comparison, terrain overlay, source point display, screenshot export, evaluation metric export, and ground projection CSV export for generated CALPUFF concentration fields.

## Repository contents

This repository includes:

* Three.js-based frontend visualization code
* Volume rendering and opacity mapping experiment code
* Terrain loading code
* Example screenshot
* Documentation for IIS deployment and sample data usage

This repository does not include:

* Complete CALPUFF preprocessing workflow
* Original meteorological data
* Original DEM data
* Backend services
* Full CALPUFF simulation output
* Three.js library files
* Large `.raw` sample data files in the Git repository

The generated sample data are provided separately as a GitHub Release asset.

## Directory structure

```text
calpuff-3d-visualization/
├─ README.md
├─ LICENSE
├─ .gitignore
├─ frontend/
│  ├─ Experiment.html
│  ├─ Experiment.js
│  └─ TerrainLoader.js
└─ screenshots/
   └─ example.png
```

## Tested environment

The project was tested in the following environment:

```text
Operating system: Windows 10
Web server: Microsoft IIS
Browser: Microsoft Edge / Google Chrome with WebGL2 support
JavaScript library: Three.js 0.147.0 / r147
```

The project requires:

1. Microsoft IIS
2. A modern browser with WebGL2 support
3. Local Three.js 0.147.0 library files
4. The generated concentration and terrain data downloaded from the GitHub Release

No Python backend is required for running this frontend demonstration.

## Three.js dependency

This repository does not include the Three.js library files.

Please download Three.js 0.147.0 and place it locally according to the following directory structure:

```text
calpuff-3d-visualization/
├─ frontend/
│  ├─ Experiment.html
│  ├─ Experiment.js
│  └─ TerrainLoader.js
└─ threejs/
   ├─ build/
   │  └─ three.module.js
   └─ examples/
      └─ jsm/
         ├─ controls/
         │  └─ OrbitControls.js
         └─ libs/
            └─ lil-gui.module.min.js
```

The HTML file uses the following import map:

```html
<script type="importmap">
{
  "imports": {
    "three": "../threejs/build/three.module.js",
    "three/addons/": "../threejs/examples/jsm/"
  }
}
</script>
```

Therefore, the `threejs` folder must be placed at the same level as the `frontend` folder.

If a different Three.js location is used, please modify the import map in:

```text
frontend/Experiment.html
```

The HTML file loads the main JavaScript file as:

```html
<script type="module" src="./Experiment.js"></script>
```

## Sample data

The generated sample data are not stored directly in the Git repository because the `.raw` files are relatively large.

Please download the sample data package from the GitHub Release page:

```text
Release asset: sample_data_40_50_60.zip
```

After downloading, unzip the package. The extracted files should have the following structure:

```text
sample_data/
└─ three/
   ├─ 3D_Matrix_40min_uniformZ_meta.json
   ├─ 3D_Matrix_40min_uniformZ.raw
   ├─ 3D_Matrix_50min_uniformZ_meta.json
   ├─ 3D_Matrix_50min_uniformZ.raw
   ├─ 3D_Matrix_60min_uniformZ_meta.json
   ├─ 3D_Matrix_60min_uniformZ.raw
   ├─ terrain_uniform_meta.json
   └─ terrain_uniform.raw
```

The data files follow the naming rule:

```text
3D_Matrix_<minute>min_uniformZ_meta.json
3D_Matrix_<minute>min_uniformZ.raw
```

The terrain files are:

```text
terrain_uniform_meta.json
terrain_uniform.raw
```

The current JavaScript file uses the following default settings:

```javascript
const DISPLAY_MINUTE = 50;
const EXPERIMENT_MINUTES = [40,50,60];
```

This means:

* The page loads the 50 min concentration field by default.
* Batch metric export uses 40 min, 50 min, and 60 min by default.

## IIS deployment

This project was tested using Microsoft IIS as the local web server.

The frontend code reads concentration and terrain data from the following fixed URL prefix:

```text
http://localhost/three/
```

Therefore, after downloading and unzipping `sample_data_40_50_60.zip`, the files inside:

```text
sample_data/three/
```

must be copied to the IIS directory corresponding to:

```text
http://localhost/three/
```

A recommended IIS deployment layout is:

```text
C:/inetpub/wwwroot/
├─ calpuff-3d-visualization/
│  ├─ frontend/
│  │  ├─ Experiment.html
│  │  ├─ Experiment.js
│  │  └─ TerrainLoader.js
│  └─ threejs/
│     ├─ build/
│     │  └─ three.module.js
│     └─ examples/
│        └─ jsm/
│           ├─ controls/
│           │  └─ OrbitControls.js
│           └─ libs/
│              └─ lil-gui.module.min.js
│
└─ three/
   ├─ 3D_Matrix_40min_uniformZ_meta.json
   ├─ 3D_Matrix_40min_uniformZ.raw
   ├─ 3D_Matrix_50min_uniformZ_meta.json
   ├─ 3D_Matrix_50min_uniformZ.raw
   ├─ 3D_Matrix_60min_uniformZ_meta.json
   ├─ 3D_Matrix_60min_uniformZ.raw
   ├─ terrain_uniform_meta.json
   └─ terrain_uniform.raw
```

In the recommended IIS layout, the frontend page can be opened through:

```text
http://localhost/calpuff-3d-visualization/frontend/Experiment.html
```

The data files should be accessible through URLs such as:

```text
http://localhost/three/3D_Matrix_40min_uniformZ_meta.json
http://localhost/three/3D_Matrix_40min_uniformZ.raw
http://localhost/three/3D_Matrix_50min_uniformZ_meta.json
http://localhost/three/3D_Matrix_50min_uniformZ.raw
http://localhost/three/3D_Matrix_60min_uniformZ_meta.json
http://localhost/three/3D_Matrix_60min_uniformZ.raw
http://localhost/three/terrain_uniform_meta.json
http://localhost/three/terrain_uniform.raw
```

Do not open the HTML file by double-clicking it directly, because browser security restrictions may block local file requests.

## IIS setup

### 1. Enable IIS

On Windows, enable IIS through:

```text
Control Panel
→ Programs
→ Turn Windows features on or off
→ Internet Information Services
```

Please make sure the following feature is enabled:

```text
Internet Information Services
└─ World Wide Web Services
   └─ Common HTTP Features
      └─ Static Content
```

### 2. Copy frontend files

Copy the frontend code to the IIS website directory, for example:

```text
C:/inetpub/wwwroot/calpuff-3d-visualization/frontend/
```

Required frontend files:

```text
Experiment.html
Experiment.js
TerrainLoader.js
```

### 3. Prepare Three.js 0.147.0

Download Three.js 0.147.0 and place the `threejs` folder under:

```text
C:/inetpub/wwwroot/calpuff-3d-visualization/threejs/
```

The required files include:

```text
threejs/build/three.module.js
threejs/examples/jsm/controls/OrbitControls.js
threejs/examples/jsm/libs/lil-gui.module.min.js
```

The final path should look like:

```text
C:/inetpub/wwwroot/calpuff-3d-visualization/threejs/build/three.module.js
C:/inetpub/wwwroot/calpuff-3d-visualization/threejs/examples/jsm/controls/OrbitControls.js
C:/inetpub/wwwroot/calpuff-3d-visualization/threejs/examples/jsm/libs/lil-gui.module.min.js
```

### 4. Download and copy sample data

Download the Release asset:

```text
sample_data_40_50_60.zip
```

Unzip it and copy all files from:

```text
sample_data/three/
```

to:

```text
C:/inetpub/wwwroot/three/
```

After copying, the following files should exist:

```text
C:/inetpub/wwwroot/three/3D_Matrix_40min_uniformZ_meta.json
C:/inetpub/wwwroot/three/3D_Matrix_40min_uniformZ.raw
C:/inetpub/wwwroot/three/3D_Matrix_50min_uniformZ_meta.json
C:/inetpub/wwwroot/three/3D_Matrix_50min_uniformZ.raw
C:/inetpub/wwwroot/three/3D_Matrix_60min_uniformZ_meta.json
C:/inetpub/wwwroot/three/3D_Matrix_60min_uniformZ.raw
C:/inetpub/wwwroot/three/terrain_uniform_meta.json
C:/inetpub/wwwroot/three/terrain_uniform.raw
```

At least the following URL should be accessible in the browser:

```text
http://localhost/three/3D_Matrix_50min_uniformZ_meta.json
```

The RAW file may be downloaded rather than displayed in the browser. This is normal.

### 5. Configure MIME types in IIS

If `.raw` files cannot be loaded or downloaded by the browser, add the following MIME type in IIS:

```text
File name extension: .raw
MIME type: application/octet-stream
```

If `.json` files cannot be loaded, check or add:

```text
File name extension: .json
MIME type: application/json
```

If `.js` module files cannot be loaded correctly, check or add:

```text
File name extension: .js
MIME type: text/javascript
```

After adding MIME types, restart the IIS website or refresh the browser cache.

## Running the visualization

After IIS and file paths are configured, open the following URL in a browser:

```text
http://localhost/calpuff-3d-visualization/frontend/Experiment.html
```

The page will load the default display minute set in:

```text
frontend/Experiment.js
```

The default setting is:

```javascript
const DISPLAY_MINUTE = 50;
```

The GUI panel can be used to:

* Switch opacity mapping methods
* Modify opacity parameters
* Export current-frame evaluation metrics as CSV
* Export ground projection CSV
* Export all selected experimental metrics as CSV
* Save screenshots

## Notes on experimental minutes

The current JavaScript file sets:

```javascript
const EXPERIMENT_MINUTES = [40,50,60];
```

Therefore, the batch metric export function uses 40 min, 50 min, and 60 min by default.

The default display time can be modified in:

```javascript
const DISPLAY_MINUTE = 50;
```

For example, to show 60 min by default:

```javascript
const DISPLAY_MINUTE = 60;
```

## Troubleshooting

### 1. The page opens, but no volume data are displayed

Check whether the data URLs can be accessed directly:

```text
http://localhost/three/3D_Matrix_50min_uniformZ_meta.json
http://localhost/three/3D_Matrix_50min_uniformZ.raw
```

If these URLs return 404, the data files are not in the correct IIS directory.

### 2. RAW files cannot be loaded

Add the `.raw` MIME type in IIS:

```text
.raw → application/octet-stream
```

Then restart the IIS website or refresh the browser cache.

### 3. The browser reports that Three.js cannot be found

Check whether the following files exist:

```text
C:/inetpub/wwwroot/calpuff-3d-visualization/threejs/build/three.module.js
C:/inetpub/wwwroot/calpuff-3d-visualization/threejs/examples/jsm/controls/OrbitControls.js
C:/inetpub/wwwroot/calpuff-3d-visualization/threejs/examples/jsm/libs/lil-gui.module.min.js
```

Also check the import map in:

```text
frontend/Experiment.html
```

### 4. The browser reports that `Experiment.js` cannot be found

Check whether the following file exists:

```text
C:/inetpub/wwwroot/calpuff-3d-visualization/frontend/Experiment.js
```

Also check whether the script tag in `Experiment.html` is:

```html
<script type="module" src="./Experiment.js"></script>
```

### 5. Terrain is not displayed

Check whether the terrain files can be accessed:

```text
http://localhost/three/terrain_uniform_meta.json
http://localhost/three/terrain_uniform.raw
```

Also make sure `TerrainLoader.js` is located in the same directory as `Experiment.js`.

### 6. The page fails when opened by double-clicking the HTML file

Do not open the HTML file directly from the local file system.

Please open it through IIS:

```text
http://localhost/calpuff-3d-visualization/frontend/Experiment.html
```

## Data availability

The frontend visualization code is provided in this repository.

The generated sample data are provided as a GitHub Release asset named:

```text
sample_data_40_50_60.zip
```

The complete CALPUFF output, original terrain data, meteorological input data, and preprocessing workflow are not included because of file size limitations. The full experimental data are available from the corresponding author upon reasonable request.

## Citation

If you use this code or data, please cite the related paper:

```text
To be updated after publication.
```

## License

This project is released under the MIT License. See the `LICENSE` file for details.
