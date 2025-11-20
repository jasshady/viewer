let scene, camera, renderer, particles;
let video, faceModel;

// HIGH RESOLUTION SETTINGS
// 160 cols x 125 rows = 20,000 particles
const gridCols = 160; 
const gridRows = 125;
const particleCount = gridCols * gridRows;

// World Dimensions (Scaled up for better camera framing)
const worldWidth = 64;  
const worldHeight = 50; 

// Processing Canvas (Hidden)
let faceCanvas, faceCtx;

// State Management
let currentState = 'sphere'; 
let targetRotationX = 0;
let targetRotationY = 0;

// Arrays to store positions
const spherePositions = new Float32Array(particleCount * 3);
const gridPositions = new Float32Array(particleCount * 3);

const themes = {
    cosmic: { h: 0.6, s: 0.7, l: 0.5 },
    neon: { h: 0.4, s: 1.0, l: 0.5 },
    sunset: { h: 0.05, s: 0.9, l: 0.5 },
    ocean: { h: 0.55, s: 0.8, l: 0.5 },
    matrix: { h: 0.33, s: 1.0, l: 0.5 }
};
let currentTheme = themes.cosmic;

function init() {
    // 1. Scene Setup
    scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050505, 0.015); // Lighter fog for distance

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); 
    document.getElementById('container').appendChild(renderer.domElement);

    // 2. Init processing canvas
    faceCanvas = document.createElement('canvas');
    faceCanvas.width = gridCols;
    faceCanvas.height = gridRows;
    faceCtx = faceCanvas.getContext('2d', { willReadFrequently: true });

    // 3. Calculate and Create Particles
    calculatePositions();
    createParticles();

    // 4. Initial Camera Fit
    adjustCamera();

    // 5. Start System
    setupWebcam();
    animate();
}

function calculatePositions() {
    // 1. SPHERE POSITIONS (Scaled up)
    for (let i = 0; i < particleCount; i++) {
        const phi = Math.acos(-1 + (2 * i) / particleCount);
        const theta = Math.sqrt(particleCount * Math.PI) * phi;
        
        const r = 22; // Larger Sphere radius
        spherePositions[i * 3] = r * Math.cos(theta) * Math.sin(phi);
        spherePositions[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
        spherePositions[i * 3 + 2] = r * Math.cos(phi);
    }

    // 2. GRID POSITIONS (Centered)
    for (let i = 0; i < particleCount; i++) {
        const col = i % gridCols;
        const row = Math.floor(i / gridCols);

        const u = col / gridCols;
        const v = row / gridRows;

        // Map to 3D space centered at 0,0
        gridPositions[i * 3] = (u - 0.5) * worldWidth;
        gridPositions[i * 3 + 1] = -(v - 0.5) * worldHeight;
        gridPositions[i * 3 + 2] = 0; 
    }
}

function createParticles() {
    const geometry = new THREE.BufferGeometry();
    const currentPositions = new Float32Array(spherePositions);
    const colors = new Float32Array(particleCount * 3);

    // Init colors
    for(let i=0; i<particleCount * 3; i+=3) {
        const color = new THREE.Color();
        const z = spherePositions[i+2];
        color.setHSL(0.6, 0.8, 0.5 + z/40);
        colors[i] = color.r;
        colors[i+1] = color.g;
        colors[i+2] = color.b;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(currentPositions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.PointsMaterial({
        size: 0.35, // Base size, adjusted dynamically later
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

        faceModel = await blazeface.load();
        detectFace();

        // Trigger morph after short delay
        setTimeout(triggerMorphSequence, 1500);

    } catch (err) {
        console.error("Webcam error:", err);
    }
}

function triggerMorphSequence() {
    currentState = 'morphing';

    const positions = particles.geometry.attributes.position.array;
    const animObj = { t: 0 };
    
    gsap.to(animObj, {
        t: 1,
        duration: 3,
        ease: "power3.inOut",
        onUpdate: () => {
            for (let i = 0; i < particleCount; i++) {
                const i3 = i * 3;
                positions[i3] = spherePositions[i3] + (gridPositions[i3] - spherePositions[i3]) * animObj.t;
                positions[i3+1] = spherePositions[i3+1] + (gridPositions[i3+1] - spherePositions[i3+1]) * animObj.t;
                positions[i3+2] = spherePositions[i3+2] + (gridPositions[i3+2] - spherePositions[i3+2]) * animObj.t;
            }
            particles.geometry.attributes.position.needsUpdate = true;
        },
        onComplete: () => {
            currentState = 'face'; 
        }
    });
    
    gsap.to(particles.rotation, { x: 0, y: 0, z: 0, duration: 2.5, ease: "power2.out" });
}

function updateParticlesFromVideo() {
    if (!video || video.readyState !== 4) return;

    faceCtx.save();
    faceCtx.scale(-1, 1); 
    faceCtx.drawImage(video, -gridCols, 0, gridCols, gridRows);
    faceCtx.restore();

    const frame = faceCtx.getImageData(0, 0, gridCols, gridRows);
    const data = frame.data;
    
    const positions = particles.geometry.attributes.position.array;
    const colors = particles.geometry.attributes.color.array;

    for (let i = 0; i < particleCount; i++) {
        const i4 = i * 4;
        const i3 = i * 3;

        const r = data[i4] / 255;
        const g = data[i4 + 1] / 255;
        const b = data[i4 + 2] / 255;
        
        const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
        
        // Z-DEPTH Logic (Pin Art)
        // Multiplier determines how much the face "pops" out
        const targetZ = (brightness * 12.0) - 4.0; 
        
        positions[i3 + 2] += (targetZ - positions[i3 + 2]) * 0.15;

        // Color Tinting
        const themeColor = new THREE.Color().setHSL(currentTheme.h, currentTheme.s, currentTheme.l);
        colors[i3] = themeColor.r * brightness + (r * 0.15);
        colors[i3+1] = themeColor.g * brightness + (g * 0.15);
        colors[i3+2] = themeColor.b * brightness + (b * 0.15);
    }
    
    particles.geometry.attributes.position.needsUpdate = true;
    particles.geometry.attributes.color.needsUpdate = true;
}

async function detectFace() {
    if (!faceModel || !video) return;

    const predictions = await faceModel.estimateFaces(video, false);

    if (predictions.length > 0) {
        const start = predictions[0].topLeft;
        const end = predictions[0].bottomRight;
        const size = [end[0] - start[0], end[1] - start[1]];
        
        const faceX = (start[0] + size[0] / 2) / video.videoWidth; 
        const faceY = (start[1] + size[1] / 2) / video.videoHeight;

        targetRotationY = (faceX - 0.5) * 0.8; 
        targetRotationX = (faceY - 0.5) * 0.4; 
    } else {
        targetRotationX *= 0.95;
        targetRotationY *= 0.95;
    }

    requestAnimationFrame(detectFace);
}

// "COVER" LOGIC FOR FULL SCREEN
function adjustCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    const fov = camera.fov * (Math.PI / 180);
    
    // Calculate distance needed to fit Height
    const distHeight = worldHeight / (2 * Math.tan(fov / 2));
    
    // Calculate distance needed to fit Width
    const distWidth = worldWidth / (2 * Math.tan(fov / 2) * aspect);
    
    // To "Cover" the screen (no borders), we must be close enough
    // that the object is LARGER than the view.
    // We pick the SMALLER distance of the two fit distances.
    const fitDist = Math.min(distHeight, distWidth);
    
    // Move slightly closer (0.9) to ensure edges are strictly cut off
    camera.position.z = fitDist * 0.9;
    
    // Adjust particle size based on zoom so they don't look sparse
    if (particles) {
        // If we are very close (low z), make particles smaller to keep resolution
        // If we are far (high z), make them bigger
        // Base scale logic roughly on standard distance 40
        particles.material.size = 0.35 * (camera.position.z / 40);
    }

    camera.aspect = aspect;
    camera.updateProjectionMatrix();
}

function changeTheme(name) {
    currentTheme = themes[name];
    document.querySelectorAll('.color-scheme button').forEach(b => b.classList.remove('active'));
    document.getElementById(`btn-${name}`).classList.add('active');
    
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
        if (currentState === 'sphere') {
            particles.rotation.y += 0.003;
            particles.rotation.z += 0.001;
        } 
        else if (currentState === 'face') {
            updateParticlesFromVideo();
            particles.rotation.x += (targetRotationX - particles.rotation.x) * 0.1;
            particles.rotation.y += (targetRotationY - particles.rotation.y) * 0.1;
        }
    }
    
    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    adjustCamera();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
