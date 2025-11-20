let scene, camera, renderer, particles;
let video, faceModel;

// GRID CONFIGURATION
// 120 cols x 100 rows = 12,000 particles
const gridCols = 120; 
const gridRows = 100;
const particleCount = gridCols * gridRows;

// Processing Canvas
let faceCanvas, faceCtx;

// Tracking
let targetRotationX = 0;
let targetRotationY = 0;

// Themes
const themes = {
    cosmic: { h: 0.6, s: 0.7, l: 0.5 }, // Blue/Pink
    neon: { h: 0.4, s: 1.0, l: 0.5 },   // Cyan/Green
    sunset: { h: 0.05, s: 0.9, l: 0.5 }, // Red/Orange
    ocean: { h: 0.55, s: 0.8, l: 0.5 }, // Deep Blue
    matrix: { h: 0.33, s: 1.0, l: 0.5 } // Pure Green
};
let currentTheme = themes.cosmic;

function init() {
    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050505, 0.03); // Darker fog for depth

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    adjustCamera();

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    document.getElementById('container').appendChild(renderer.domElement);

    // 2. Init processing canvas (hidden)
    faceCanvas = document.createElement('canvas');
    faceCanvas.width = gridCols;
    faceCanvas.height = gridRows;
    faceCtx = faceCanvas.getContext('2d', { willReadFrequently: true });

    // 3. Create Particles
    createParticleGrid();

    // 4. Start System
    setupWebcam();
    animate();
}

function createParticleGrid() {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);

    // Create a centered grid
    // Width: 30 units, Height: 25 units (4:3 aspect ratio approx)
    const width = 30;
    const height = 25;

    for (let i = 0; i < particleCount; i++) {
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);

        // Normalize coordinates (-0.5 to 0.5)
        const u = col / gridCols;
        const v = row / gridRows;

        // Map to 3D space
        // We center it by subtracting 0.5
        const x = (u - 0.5) * width;
        const y = -(v - 0.5) * height; // Flip Y for correct orientation
        const z = 0; 

        const i3 = i * 3;
        positions[i3] = x;
        positions[i3 + 1] = y;
        positions[i3 + 2] = z;

        // Set initial color (will be overwritten by video)
        colors[i3] = 1;
        colors[i3+1] = 1;
        colors[i3+2] = 1;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.25, // Size of each "pixel"
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        opacity: 0.9
    });

    particles = new THREE.Points(geometry, material);
    scene.add(particles);
}

async function setupWebcam() {
    video = document.getElementById('webcam');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { 
                facingMode: 'user', 
                width: { ideal: 640 }, 
                height: { ideal: 480 } 
            },
            audio: false
        });
        video.srcObject = stream;
        
        await new Promise(resolve => video.onloadedmetadata = resolve);
        await video.play();

        // Start tracking after video is live
        faceModel = await blazeface.load();
        detectFace();

    } catch (err) {
        console.error("Webcam error:", err);
        alert("Camera access needed for the mirror effect!");
    }
}

// Updates particle Z-positions and Colors based on video frame
function updateParticles() {
    if (!video || video.readyState !== 4) return;

    // 1. Draw video to small canvas (Scaling down acts as pixelation)
    // Scale(-1, 1) creates the mirror effect
    faceCtx.save();
    faceCtx.scale(-1, 1);
    faceCtx.drawImage(video, -gridCols, 0, gridCols, gridRows);
    faceCtx.restore();

    // 2. Get pixel data
    const frame = faceCtx.getImageData(0, 0, gridCols, gridRows);
    const data = frame.data;
    
    const positions = particles.geometry.attributes.position.array;
    const colors = particles.geometry.attributes.color.array;

    for (let i = 0; i < particleCount; i++) {
        const i4 = i * 4; // Pixel index (R,G,B,A)
        const i3 = i * 3; // Particle index (X,Y,Z)

        const r = data[i4] / 255;
        const g = data[i4 + 1] / 255;
        const b = data[i4 + 2] / 255;
        
        // Calculate Brightness (Luma)
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        
        // PIN ART EFFECT:
        // Brighter pixels move closer to camera (positive Z)
        // Darker pixels recede (negative Z)
        const targetZ = (brightness * 10) - 5; // Range: -5 to +5

        // Smooth interpolation (Lerp) for fluid movement
        positions[i3 + 2] += (targetZ - positions[i3 + 2]) * 0.15;

        // COLOR MIXING:
        // Mix video color with Theme color
        // If theme is Matrix (green), we force green channel
        if (currentTheme === themes.matrix) {
            colors[i3] = 0;
            colors[i3 + 1] = brightness * 1.5; // Bright green
            colors[i3 + 2] = 0;
        } else {
            // Tint the video with the selected theme
            // We use Soft Light blending logic roughly
            colors[i3] = (r * 0.5) + (currentTheme.h * 0.5); 
            colors[i3 + 1] = (g * 0.5) + (currentTheme.s * 0.5 * brightness); // Saturation affects mix
            colors[i3 + 2] = (b * 0.5) + (currentTheme.l * 0.5);
            
            // Alternative: Just use video colors slightly tinted
            // colors[i3] += (r - colors[i3]) * 0.1;
            // colors[i3+1] += (g - colors[i3+1]) * 0.1;
            // colors[i3+2] += (b - colors[i3+2]) * 0.1;
            
            // Let's stick to a clean tint based on brightness for a "Hologram" look
            const themeColor = new THREE.Color().setHSL(currentTheme.h, currentTheme.s, currentTheme.l);
            colors[i3] = themeColor.r * brightness * 2;
            colors[i3+1] = themeColor.g * brightness * 2;
            colors[i3+2] = themeColor.b * brightness * 2;
        }
    }
    
    particles.geometry.attributes.position.needsUpdate = true;
    particles.geometry.attributes.color.needsUpdate = true;
}

// Face Tracking for Rotation
async function detectFace() {
    if (!faceModel || !video) return;

    const predictions = await faceModel.estimateFaces(video, false);

    if (predictions.length > 0) {
        const start = predictions[0].topLeft;
        const end = predictions[0].bottomRight;
        const size = [end[0] - start[0], end[1] - start[1]];
        
        const faceX = (start[0] + size[0] / 2) / video.videoWidth; 
        const faceY = (start[1] + size[1] / 2) / video.videoHeight;

        // Calculate rotation based on face position
        // Looking Left (faceX < 0.5) -> Rotate Y negative
        targetRotationY = (faceX - 0.5) * 1.5; 
        targetRotationX = (faceY - 0.5) * 1.0; 
    } else {
        // Center if no face
        targetRotationX *= 0.95;
        targetRotationY *= 0.95;
    }

    requestAnimationFrame(detectFace);
}

function adjustCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    if (aspect < 0.7) {
        // Mobile Portrait
        camera.position.z = 45; 
    } else if (aspect < 1) {
        // Tablet
        camera.position.z = 35;
    } else {
        // Desktop
        camera.position.z = 25;
    }
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}

function changeTheme(name) {
    currentTheme = themes[name];
    document.querySelectorAll('.color-scheme button').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${name}`).classList.add('active');
    
    // Update Title Gradient
    const header = document.querySelector('.header h1');
    let gradient = 'linear-gradient(45deg, #ff6e7f, #bfe9ff)';
    if(name === 'neon') gradient = 'linear-gradient(45deg, #00ff87, #60efff)';
    if(name === 'sunset') gradient = 'linear-gradient(45deg, #ff8c37, #ff427a)';
    if(name === 'ocean') gradient = 'linear-gradient(45deg, #0082c8, #00b4db)';
    if(name === 'matrix') gradient = 'linear-gradient(45deg, #00ff00, #003300)';
    
    header.style.background = gradient;
    header.style.webkitBackgroundClip = 'text';
    header.style.backgroundClip = 'text';
}

function animate() {
    requestAnimationFrame(animate);

    if (particles) {
        updateParticles();

        // Apply smooth rotation from face tracking
        particles.rotation.x += (targetRotationX - particles.rotation.x) * 0.05;
        particles.rotation.y += (targetRotationY - particles.rotation.y) * 0.05;
    }
    
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    adjustCamera();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
