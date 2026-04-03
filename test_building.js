import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
// import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
// import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { IFCLoader } from 'web-ifc-three';
import { IFCSPACE } from 'web-ifc';

let camera, scene, renderer;
let ifcLoader;
let raycaster;
let mouse;
let selectedModel = null;
let selectedExpressID = null;
let selectedSubset = null;
let selectedSpaceSubset = null;
let controls;
let modelLoaded = false;
let initialized = false;
let spaceList = [];
let spaceChart = null;
let chartResizeHandler = null;
let chartUpdateTimer = null;
let cameraStream = null;

// YOLOv8 检测相关变量
let yoloSession = null;
let yoloModelLoaded = false;
let isDetecting = false;
let detectionAnimationFrame = null;
let isProcessingFrame = false; // 防止重复处理
let lastDetectionTime = 0;
const IMAGE_SIZE = 640; // YOLOv8 输入尺寸
const DETECTION_INTERVAL = 100; // 检测间隔（毫秒），约10fps

// COCO 类别名称（YOLOv8 默认使用 COCO 数据集）
const CLASS_NAMES = [
    'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
    'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat',
    'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack',
    'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball',
    'kite', 'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket',
    'bottle', 'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple',
    'sandwich', 'orange', 'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair',
    'couch', 'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
    'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink', 'refrigerator',
    'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier', 'toothbrush'
];

// 与 HTML 同目录放置；中文路径在部分浏览器/服务器下需编码
const IFC_MODEL_URL = encodeURI( '地坤楼2020IoT2x3.ifc' );

async function init() {
    // 确保只初始化一次
    if ( initialized ) return;

//Scene
scene = new THREE.Scene();
scene.background = new THREE.Color( 0x0a1929 );

//Camera
camera = new THREE.PerspectiveCamera( 45, window.innerWidth / window.innerHeight, 0.1, 1000 );
camera.position.z = - 70;
camera.position.y = 25;
camera.position.x = 90;

// //Initial cube
// const geometry = new THREE.BoxGeometry();
// const material = new THREE.MeshPhongMaterial( { color: 0xffffff } );
// const cube = new THREE.Mesh( geometry, material );
// scene.add( cube );

//Lights
const directionalLight1 = new THREE.DirectionalLight( 0xffeeff, 2.5 );
directionalLight1.position.set( 1, 1, 1 );
scene.add( directionalLight1 );

const directionalLight2 = new THREE.DirectionalLight( 0xffffff, 2.5 );
directionalLight2.position.set( - 1, 0.5, - 1 );
scene.add( directionalLight2 );

const ambientLight = new THREE.AmbientLight( 0xffffee, 0.75 );
scene.add( ambientLight );


// 坐标轴辅助（可选）
const axesHelper = new THREE.AxesHelper(100);
scene.add(axesHelper);

// 初始化Raycaster和鼠标位置
raycaster = new THREE.Raycaster();
mouse = new THREE.Vector2();

//Setup IFC Loader
    try {
        ifcLoader = new IFCLoader();
        await ifcLoader.ifcManager.setWasmPath( 'https://cdn.jsdelivr.net/npm/web-ifc@0.0.36/', true );

        await ifcLoader.ifcManager.parser.setupOptionalCategories( {
            [ IFCSPACE ]: true,
        } );

        await ifcLoader.ifcManager.applyWebIfcConfig( {
            USE_FAST_BOOLS: true
        } );
    } catch ( err ) {
        console.error( 'IFC 引擎初始化失败（常为网络无法加载 web-ifc WASM）:', err );
        const spaceListDiv = document.getElementById( 'space-list' );
        if ( spaceListDiv ) {
            spaceListDiv.innerHTML = '<div style="color: #ff6b9d; padding: 12px;">IFC 引擎初始化失败，请检查网络能否访问 jsdelivr，或查看控制台。</div>';
        }
        return;
    }

    initialized = true;

// 确保模型只加载一次
if ( !modelLoaded ) {
    modelLoaded = true;
    ifcLoader.load(
        IFC_MODEL_URL,
        async function ( model ) {
        // 检查模型是否已经在场景中
        if ( !scene.children.includes( model.mesh ) ) {
            scene.add( model.mesh );
        }
        selectedModel = model;
        // 加载空间列表
        await loadSpaceList( model.modelID );

        },
        undefined,
        function ( err ) {
            console.error( '加载 IFC 文件失败:', err );
            modelLoaded = false;
            const spaceListDiv = document.getElementById( 'space-list' );
            const msg = ( err && err.message ) ? err.message : String( err );
            if ( spaceListDiv ) {
                spaceListDiv.innerHTML = '<div style="color: #ff6b9d; padding: 12px;">IFC 加载失败：' + msg + '<br><span style="color:#7a9fb8;font-size:12px;">请确认模型文件与网页同目录，且用 http:// 打开（不要用 file://）。</span></div>';
            }
        }
    );
}


//Renderer
renderer = new THREE.WebGLRenderer( { antialias: true } );
const rendererContainer = document.getElementById( 'renderer-container' );
if ( rendererContainer ) {
    rendererContainer.appendChild( renderer.domElement );
    // 延迟设置大小，确保容器已渲染
    setTimeout( function() {
        updateRendererSize();
    }, 100 );
} else {
    document.body.appendChild( renderer.domElement );
    renderer.setSize( window.innerWidth, window.innerHeight );
}
renderer.setPixelRatio( window.devicePixelRatio );

//Controls
controls = new OrbitControls( camera, renderer.domElement );
// controls.enableDamping = true; // 启用阻尼，使控制更平滑
// controls.dampingFactor = 0.5;

// 添加鼠标点击事件监听器（区分左键和右键）
renderer.domElement.addEventListener( 'mousedown', onMouseDown, false );

// 阻止右键菜单
renderer.domElement.addEventListener( 'contextmenu', ( event ) => {
    event.preventDefault();
    onRightClick( event );
}, false );
window.addEventListener( 'resize', onWindowResize );

// 添加图表关闭按钮事件（延迟执行确保DOM已加载）
setTimeout( function() {
    const closeBtn = document.getElementById( 'chart-close-btn' );
    if ( closeBtn ) {
        closeBtn.addEventListener( 'click', function() {
            hideSpaceChart();
            clearSpaceHighlight();
            // 清除空间列表中的选中状态
            const spaceItems = document.querySelectorAll( '.space-item' );
            spaceItems.forEach( item => {
                item.style.background = 'rgba(0, 212, 255, 0.05)';
                item.style.borderColor = 'rgba(0, 212, 255, 0.2)';
                item.style.boxShadow = 'none';
            } );
        } );
    }
}, 100 );

// 启动动画循环
animate();
}


function updateRendererSize() {
    const rendererContainer = document.getElementById( 'renderer-container' );
    if ( rendererContainer && renderer ) {
        const width = rendererContainer.clientWidth;
        const height = rendererContainer.clientHeight;
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        renderer.setSize( width, height );
    }
}

function onWindowResize() {
    updateRendererSize();
    
    // 如果图表显示，调整图表大小和位置
    if ( spaceChart ) {
        setTimeout( function() {
            spaceChart.resize();
            // 重新计算图表区位置
            const chartPanel = document.getElementById( 'space-chart-panel' );
            const spaceListPanel = document.getElementById( 'space-list-panel' );
            if ( chartPanel && spaceListPanel && chartPanel.style.display === 'flex' ) {
                const spaceListRect = spaceListPanel.getBoundingClientRect();
                const mainContentRect = document.getElementById( 'main-content' ).getBoundingClientRect();
                const topPosition = spaceListRect.bottom - mainContentRect.top + 16;
                chartPanel.style.top = topPosition + 'px';
            }
        }, 100 );
    }
}



function onMouseDown( event ) {
    // 只处理左键点击（button === 0）
    if ( event.button !== 0 || !selectedModel ) return;
    // 计算鼠标在归一化设备坐标中的位置
    mouse.x = ( event.clientX / window.innerWidth ) * 2 - 1;
    mouse.y = - ( event.clientY / window.innerHeight ) * 2 + 1;
    // 更新raycaster
    raycaster.setFromCamera( mouse, camera );
    // 获取与raycaster相交的对象
    const intersects = raycaster.intersectObject( selectedModel.mesh, true );
    if ( intersects.length > 0 ) {
        const intersect = intersects[ 0 ];
        const faceIndex = intersect.faceIndex;
        const geometry = intersect.object.geometry;
        const id = ifcLoader.ifcManager.getExpressId( geometry, faceIndex );
        // 如果点击的是同一个构件，不做处理；否则选择新构件
        if ( selectedExpressID !== id ) {
            // 取消之前的高亮
            clearHighlight();            
            // 高亮选中的构件
            selectedExpressID = id;
            selectedSubset = ifcLoader.ifcManager.createSubset( {
                modelID: selectedModel.modelID,
                ids: [ id ],
                removePrevious: true,
                material: new THREE.MeshPhongMaterial( {
                    color: 0x00d4ff,
                    transparent: true,
                    opacity: 0.5,
                    depthTest: false,
                    emissive: 0x001122,
                    emissiveIntensity: 0.3
                } )
            } );            
            if ( selectedSubset ) {
                selectedModel.mesh.add( selectedSubset );
            }
            // 获取并显示构件信息
            displayElementInfo( id );
        }
    }
}

function clearHighlight() {
    // 清除高亮显示
    if ( selectedModel && selectedExpressID !== null ) {
        // 移除高亮子集
        ifcLoader.ifcManager.removeSubset( selectedModel.modelID );      
        // 如果子集对象存在，也从场景中移除
        if ( selectedSubset && selectedModel.mesh ) {
            selectedModel.mesh.remove( selectedSubset );
        }       
        // 清除引用
        selectedSubset = null;
        selectedExpressID = null;
    }
}

function clearSpaceHighlight() {
    // 清除空间高亮显示
    if ( selectedModel && selectedSpaceSubset ) {
        // 如果子集对象存在，从场景中移除
        if ( selectedModel.mesh ) {
            selectedModel.mesh.remove( selectedSpaceSubset );
        }       
        // 移除空间高亮子集
        try {
            ifcLoader.ifcManager.removeSubset( selectedModel.modelID, selectedSpaceSubset );
        } catch ( error ) {
            console.warn( '移除空间子集失败:', error );
        }       
        // 清除引用
        selectedSpaceSubset = null;
    }
    
    // 隐藏图表面板
    hideSpaceChart();
}

function onRightClick( event ) {
    // 右键取消选中并移除高亮
    if ( selectedExpressID !== null || selectedSpaceSubset !== null ) {
        // 清除高亮
        clearHighlight();
        clearSpaceHighlight();      
        // 隐藏信息面板
        hideElementInfo();       
        // 清除空间列表中的选中状态
        const spaceItems = document.querySelectorAll( '.space-item' );
        spaceItems.forEach( item => {
            item.style.background = 'rgba(0, 212, 255, 0.05)';
            item.style.borderColor = 'rgba(0, 212, 255, 0.2)';
            item.style.boxShadow = 'none';
        } );
    }
}

async function displayElementInfo( expressID ) {
    if ( !selectedModel ) return;
    const infoPanel = document.getElementById( 'element-info' );
    const infoPlaceholder = document.getElementById( 'element-info-placeholder' );
    const detailsDiv = document.getElementById( 'element-details' );
    
    // 隐藏占位符，显示信息面板
    if ( infoPlaceholder ) {
        infoPlaceholder.style.display = 'none';
    }
    if ( infoPanel ) {
        infoPanel.style.display = 'block';
    }
    
    // 显示加载状态
    detailsDiv.innerHTML = '<div style="color: #7a9fb8; text-align: center; padding: 20px;"><span style="color: #00d4ff;">⏳</span> 正在加载构件信息...</div>';
    try {
        // 获取构件属性
        const properties = await ifcLoader.ifcManager.getItemProperties( selectedModel.modelID, expressID, false );    
        // 获取属性集
        const propertySets = await ifcLoader.ifcManager.getPropertySets( selectedModel.modelID, expressID, false );     
        // 获取类型属性
        const typeProperties = await ifcLoader.ifcManager.getTypeProperties( selectedModel.modelID, expressID, false );
        // 构建信息显示HTML
        let html = '';
        // 基本信息
        html += '<div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(0, 212, 255, 0.3);">';
        html += '<strong style="color: #00d4ff; text-shadow: 0 0 8px rgba(0, 212, 255, 0.5);">基本信息</strong><br>';
        html += '<span style="color: #b0d4e8;">Express ID:</span> <span style="color: #e0f2fe;">' + expressID + '</span><br>';       
        if ( properties.type ) {
            html += '<span style="color: #b0d4e8;">类型:</span> <span style="color: #e0f2fe;">' + properties.type + '</span><br>';
        }
        if ( properties.Name && properties.Name.value ) {
            html += '<span style="color: #b0d4e8;">名称:</span> <span style="color: #e0f2fe;">' + properties.Name.value + '</span><br>';
        }
        if ( properties.GlobalId && properties.GlobalId.value ) {
            html += '<span style="color: #b0d4e8;">全局ID:</span> <span style="color: #e0f2fe;">' + properties.GlobalId.value + '</span><br>';
        }
        html += '</div>';
        // 属性集
        if ( propertySets && propertySets.length > 0 ) {
            html += '<div style="margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid rgba(0, 212, 255, 0.3);">';
            html += '<strong style="color: #00d4ff; text-shadow: 0 0 8px rgba(0, 212, 255, 0.5);">属性集</strong><br>';
            propertySets.forEach( ( ps, index ) => {
                if ( ps.Name && ps.Name.value ) {
                    html += '<div style="margin-top: 8px; padding-left: 10px; border-left: 2px solid rgba(0, 212, 255, 0.5);">';
                    html += '<strong style="color: #4fc3f7;">' + ps.Name.value + '</strong><br>';
                    if ( ps.HasProperties && Array.isArray( ps.HasProperties ) ) {
                        ps.HasProperties.forEach( prop => {
                            if ( prop.Name && prop.Name.value && prop.NominalValue ) {
                                html += '<span style="color: #b0d4e8;">' + prop.Name.value + ':</span> ';
                                if ( prop.NominalValue.value ) {
                                    html += '<span style="color: #e0f2fe;">' + prop.NominalValue.value + '</span><br>';
                                } else if ( prop.NominalValue.wrappedValue ) {
                                    html += '<span style="color: #e0f2fe;">' + prop.NominalValue.wrappedValue + '</span><br>';
                                } else {
                                    html += '<span style="color: #e0f2fe;">' + JSON.stringify( prop.NominalValue ) + '</span><br>';
                                }
                            }
                        } );
                    }
                    html += '</div>';
                }
            } );
            html += '</div>';
        }

        // 类型属性
        if ( typeProperties && typeProperties.length > 0 ) {
            html += '<div style="margin-bottom: 15px;">';
            html += '<strong style="color: #00d4ff; text-shadow: 0 0 8px rgba(0, 212, 255, 0.5);">类型属性</strong><br>';
            typeProperties.forEach( ( tp, index ) => {
                if ( tp.Name && tp.Name.value ) {
                    html += '<div style="margin-top: 8px; padding-left: 10px; border-left: 2px solid rgba(0, 212, 255, 0.5);">';
                    html += '<strong style="color: #4fc3f7;">' + tp.Name.value + '</strong><br>';
                    if ( tp.HasProperties && Array.isArray( tp.HasProperties ) ) {
                        tp.HasProperties.forEach( prop => {
                            if ( prop.Name && prop.Name.value && prop.NominalValue ) {
                                html += '<span style="color: #b0d4e8;">' + prop.Name.value + ':</span> ';
                                if ( prop.NominalValue.value ) {
                                    html += '<span style="color: #e0f2fe;">' + prop.NominalValue.value + '</span><br>';
                                } else if ( prop.NominalValue.wrappedValue ) {
                                    html += '<span style="color: #e0f2fe;">' + prop.NominalValue.wrappedValue + '</span><br>';
                                } else {
                                    html += '<span style="color: #e0f2fe;">' + JSON.stringify( prop.NominalValue ) + '</span><br>';
                                }
                            }
                        } );
                    }
                    html += '</div>';
                }
            } );
            html += '</div>';
        }

        // 如果没有找到任何信息
        if ( html === '' ) {
            html = '<div style="color: #7a9fb8;">未找到构件详细信息</div>';
        }
        detailsDiv.innerHTML = html;
    } catch ( error ) {
        console.error( '获取构件信息失败:', error );
        detailsDiv.innerHTML = '<div style="color: #ff6b9d; background: rgba(255, 107, 157, 0.1); padding: 10px; border-radius: 6px; border-left: 3px solid #ff6b9d;">获取构件信息时出错: ' + error.message + '</div>';
    }
}

function hideElementInfo() {
    const infoPanel = document.getElementById( 'element-info' );
    const infoPlaceholder = document.getElementById( 'element-info-placeholder' );
    
    if ( infoPanel ) {
        infoPanel.style.display = 'none';
    }
    if ( infoPlaceholder ) {
        infoPlaceholder.style.display = 'flex';
    }
}

async function loadSpaceList( modelID ) {
    try {
        const spaceListDiv = document.getElementById( 'space-list' );
        spaceListDiv.innerHTML = '<div style="color: #7a9fb8; text-align: center; padding: 20px;"><span style="color: #00d4ff;">⏳</span> 正在加载空间列表...</div>';
        // 获取所有IFCSPACE类型的元素
        const spaces = await ifcLoader.ifcManager.getAllItemsOfType( modelID, IFCSPACE, false );      
        spaceList = [];
        if ( spaces && spaces.length > 0 ) {
            // 获取每个空间的属性
            for ( const space of spaces ) {
                try {
                    const properties = await ifcLoader.ifcManager.getItemProperties( modelID, space, false );
                    const name = properties.Name && properties.Name.value ? properties.Name.value : `空间 ${space}`;
                    spaceList.push( {
                        expressID: space,
                        name: name,
                        properties: properties
                    } );
                } catch ( error ) {
                    console.warn( `获取空间 ${space} 属性失败:`, error );
                    spaceList.push( {
                        expressID: space,
                        name: `空间 ${space}`,
                        properties: null
                    } );
                }
            }
            // 渲染空间列表
            renderSpaceList();
        } else {
            spaceListDiv.innerHTML = '<div style="color: #7a9fb8; text-align: center; padding: 20px;">未找到空间数据</div>';
        }

    } catch ( error ) {
        console.error( '加载空间列表失败:', error );
        const spaceListDiv = document.getElementById( 'space-list' );
        spaceListDiv.innerHTML = '<div style="color: #ff6b9d; background: rgba(255, 107, 157, 0.1); padding: 10px; border-radius: 6px; border-left: 3px solid #ff6b9d;">加载空间列表时出错: ' + error.message + '</div>';
    }
}

function renderSpaceList() {
    const spaceListDiv = document.getElementById( 'space-list' );
    if ( spaceList.length === 0 ) {
        spaceListDiv.innerHTML = '<div style="color: #7a9fb8; text-align: center; padding: 20px;">未找到空间数据</div>';
        return;
    }
    let html = ''; 
    spaceList.forEach( ( space, index ) => {
        html += '<div class="space-item" data-space-id="' + space.expressID + '" style="padding: 12px; margin-bottom: 8px; background: rgba(0, 212, 255, 0.05); border: 1px solid rgba(0, 212, 255, 0.2); border-radius: 8px; cursor: pointer; transition: all 0.3s ease; border-left: 3px solid rgba(0, 212, 255, 0.3);">';
        html += '<div style="color: #00d4ff; font-weight: 600; margin-bottom: 4px; text-shadow: 0 0 8px rgba(0, 212, 255, 0.3);">' + space.name + '</div>';
        html += '<div style="color: #b0d4e8; font-size: 11px;">ID: ' + space.expressID + '</div>';
        html += '</div>';
    } );

    spaceListDiv.innerHTML = html;

    // 添加点击事件监听器
    const spaceItems = spaceListDiv.querySelectorAll( '.space-item' );
    spaceItems.forEach( item => {
        item.addEventListener( 'click', function() {
            const spaceID = parseInt( this.getAttribute( 'data-space-id' ) );
            highlightSpace( spaceID );
            
            // 高亮当前选中的项
            spaceItems.forEach( i => {
                i.style.background = 'rgba(0, 212, 255, 0.05)';
                i.style.borderColor = 'rgba(0, 212, 255, 0.2)';
            } );
            this.style.background = 'rgba(0, 212, 255, 0.15)';
            this.style.borderColor = 'rgba(0, 212, 255, 0.6)';
            this.style.boxShadow = '0 0 15px rgba(0, 212, 255, 0.4)';
        } );
        
        // 添加悬停效果
        item.addEventListener( 'mouseenter', function() {
            if ( this.style.background !== 'rgba(0, 212, 255, 0.15)' ) {
                this.style.background = 'rgba(0, 212, 255, 0.1)';
                this.style.borderColor = 'rgba(0, 212, 255, 0.4)';
            }
        } );
        
        item.addEventListener( 'mouseleave', function() {
            if ( this.style.background !== 'rgba(0, 212, 255, 0.15)' ) {
                this.style.background = 'rgba(0, 212, 255, 0.05)';
                this.style.borderColor = 'rgba(0, 212, 255, 0.2)';
            }
        } );
    } );

}

function highlightSpace( spaceID ) {
    if ( !selectedModel ) return;
    // 清除之前的高亮（包括构件高亮和空间高亮）
    clearHighlight();
    clearSpaceHighlight();
    try {
        // 高亮选中的空间
        selectedSpaceSubset = ifcLoader.ifcManager.createSubset( {
            modelID: selectedModel.modelID,
            ids: [ spaceID ],
            removePrevious: false,
            material: new THREE.MeshPhongMaterial( {
                color: 0x4fc3f7,
                transparent: true,
                opacity: 0.6,
                depthTest: false,
                emissive: 0x002244,
                emissiveIntensity: 0.4
            } )
        } );
        
        if ( selectedSpaceSubset ) {
            selectedModel.mesh.add( selectedSpaceSubset );
        }
        // 尝试将相机聚焦到空间
        focusOnSpace( spaceID );
        
        // 加载并显示空间数据图表
        loadSpaceChart();
    } catch ( error ) {
        console.error( '高亮空间失败:', error );
    }
}

async function focusOnSpace( spaceID ) {
    try {
        // 获取空间的边界框
        const bbox = await ifcLoader.ifcManager.getBoundingBox( selectedModel.modelID, spaceID );    
        if ( bbox ) {
            const center = new THREE.Vector3();
            bbox.getCenter( center );
            
            const size = new THREE.Vector3();
            bbox.getSize( size );
            
            const maxDim = Math.max( size.x, size.y, size.z );
            const distance = maxDim * 2;
            
            // 计算相机位置
            const direction = new THREE.Vector3( 0, 0, -1 );
            direction.applyQuaternion( camera.quaternion );
            
            camera.position.copy( center ).add( direction.multiplyScalar( distance ) );
            controls.target.copy( center );
            controls.update();
        }
    } catch ( error ) {
        console.warn( '聚焦空间失败:', error );
    }
}

async function updateChartData() {
    if ( !spaceChart ) return;
    
    try {
        // 从API获取数据
        const response = await fetch( 'https://ezdata.m5stack.com/api/store/OeKZH1u8yeevThMeDx6s4B8bxbfHb6Tc/data' );
        const result = await response.json();
        
        if ( result.status === 1 && result.data && result.data.length > 0 ) {
            // 处理数据
            const times = result.data.map( item => item.time ).reverse(); // 反转以显示时间顺序
            const temps = result.data.map( item => item.temp ).reverse();
            const humids = result.data.map( item => item.humid ).reverse();
            
            // 更新图表数据
            spaceChart.setOption( {
                xAxis: [ {
                    data: times
                } ],
                series: [
                    {
                        name: '温度 (°C)',
                        data: temps
                    },
                    {
                        name: '湿度 (%)',
                        data: humids
                    }
                ]
            } );
        }
    } catch ( error ) {
        console.error( '更新图表数据失败:', error );
    }
}

async function loadSpaceChart() {
    const chartPanel = document.getElementById( 'space-chart-panel' );
    const chartDiv = document.getElementById( 'space-chart' );
    
    if ( !chartPanel || !chartDiv ) return;
    
    // 清除之前的定时器（如果存在）
    if ( chartUpdateTimer ) {
        clearInterval( chartUpdateTimer );
        chartUpdateTimer = null;
    }
    
    // 显示图表面板（使用flex显示）
    chartPanel.style.display = 'flex';
    
    // 动态计算图表区位置：放在空间列表区下方
    const spaceListPanel = document.getElementById( 'space-list-panel' );
    if ( spaceListPanel ) {
        const spaceListRect = spaceListPanel.getBoundingClientRect();
        const mainContentRect = document.getElementById( 'main-content' ).getBoundingClientRect();
        // 计算相对于 main-content 的位置
        const topPosition = spaceListRect.bottom - mainContentRect.top + 16; // 16px 间距
        chartPanel.style.top = topPosition + 'px';
    }
    
    // 显示加载状态
    chartDiv.innerHTML = '<div style="color: #7a9fb8; text-align: center; padding: 50px;"><span style="color: #00d4ff;">⏳</span> 正在加载数据...</div>';
    
    try {
        // 从API获取数据
        const response = await fetch( 'https://ezdata.m5stack.com/api/store/OeKZH1u8yeevThMeDx6s4B8bxbfHb6Tc/data' );
        const result = await response.json();
        
        if ( result.status === 1 && result.data && result.data.length > 0 ) {
            // 处理数据
            const times = result.data.map( item => item.time ).reverse(); // 反转以显示时间顺序
            const temps = result.data.map( item => item.temp ).reverse();
            const humids = result.data.map( item => item.humid ).reverse();
            
            // 初始化ECharts实例
            if ( spaceChart ) {
                spaceChart.dispose();
            }
            spaceChart = echarts.init( chartDiv );
            
            // 配置图表选项
            const option = {
                backgroundColor: 'transparent',
                textStyle: {
                    color: '#e0f2fe',
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", sans-serif'
                },
                tooltip: {
                    trigger: 'axis',
                    axisPointer: {
                        type: 'cross',
                        crossStyle: {
                            color: '#00d4ff'
                        }
                    },
                    backgroundColor: 'rgba(10, 25, 41, 0.95)',
                    borderColor: 'rgba(0, 212, 255, 0.5)',
                    borderWidth: 1,
                    textStyle: {
                        color: '#e0f2fe'
                    }
                },
                legend: {
                    data: [ '温度 (°C)', '湿度 (%)' ],
                    textStyle: {
                        color: '#e0f2fe'
                    },
                    top: 10
                },
                grid: {
                    left: '3%',
                    right: '4%',
                    bottom: '3%',
                    top: '15%',
                    containLabel: true
                },
                xAxis: [
                    {
                        type: 'category',
                        data: times,
                        axisPointer: {
                            type: 'shadow'
                        },
                        axisLine: {
                            lineStyle: {
                                color: '#00d4ff'
                            }
                        },
                        axisLabel: {
                            color: '#b0d4e8',
                            rotate: 45
                        },
                        splitLine: {
                            show: true,
                            lineStyle: {
                                color: 'rgba(0, 212, 255, 0.1)'
                            }
                        }
                    }
                ],
                yAxis: [
                    {
                        type: 'value',
                        name: '温度 (°C)',
                        min: 'dataMin',
                        max: 'dataMax',
                        position: 'left',
                        axisLine: {
                            lineStyle: {
                                color: '#00d4ff'
                            }
                        },
                        axisLabel: {
                            color: '#b0d4e8',
                            formatter: '{value}'
                        },
                        splitLine: {
                            show: true,
                            lineStyle: {
                                color: 'rgba(0, 212, 255, 0.1)'
                            }
                        },
                        nameTextStyle: {
                            color: '#00d4ff'
                        }
                    },
                    {
                        type: 'value',
                        name: '湿度 (%)',
                        min: 'dataMin',
                        max: 'dataMax',
                        position: 'right',
                        axisLine: {
                            lineStyle: {
                                color: '#4fc3f7'
                            }
                        },
                        axisLabel: {
                            color: '#b0d4e8',
                            formatter: '{value}'
                        },
                        splitLine: {
                            show: false
                        },
                        nameTextStyle: {
                            color: '#4fc3f7'
                        }
                    }
                ],
                series: [
                    {
                        name: '温度 (°C)',
                        type: 'line',
                        yAxisIndex: 0,
                        data: temps,
                        smooth: true,
                        lineStyle: {
                            color: '#00d4ff',
                            width: 2
                        },
                        itemStyle: {
                            color: '#00d4ff'
                        },
                        areaStyle: {
                            color: {
                                type: 'linear',
                                x: 0,
                                y: 0,
                                x2: 0,
                                y2: 1,
                                colorStops: [
                                    { offset: 0, color: 'rgba(0, 212, 255, 0.3)' },
                                    { offset: 1, color: 'rgba(0, 212, 255, 0.05)' }
                                ]
                            }
                        },
                        emphasis: {
                            focus: 'series'
                        }
                    },
                    {
                        name: '湿度 (%)',
                        type: 'line',
                        yAxisIndex: 1,
                        data: humids,
                        smooth: true,
                        lineStyle: {
                            color: '#4fc3f7',
                            width: 2
                        },
                        itemStyle: {
                            color: '#4fc3f7'
                        },
                        areaStyle: {
                            color: {
                                type: 'linear',
                                x: 0,
                                y: 0,
                                x2: 0,
                                y2: 1,
                                colorStops: [
                                    { offset: 0, color: 'rgba(79, 195, 247, 0.3)' },
                                    { offset: 1, color: 'rgba(79, 195, 247, 0.05)' }
                                ]
                            }
                        },
                        emphasis: {
                            focus: 'series'
                        }
                    }
                ]
            };
            
            // 设置图表选项
            spaceChart.setOption( option );
            
            // 响应窗口大小变化（使用防抖避免频繁调用）
            if ( chartResizeHandler ) {
                window.removeEventListener( 'resize', chartResizeHandler );
            }
            
            let resizeTimer = null;
            chartResizeHandler = function() {
                if ( resizeTimer ) {
                    clearTimeout( resizeTimer );
                }
                resizeTimer = setTimeout( function() {
                    if ( spaceChart ) {
                        spaceChart.resize();
                    }
                }, 100 );
            };
            
            window.addEventListener( 'resize', chartResizeHandler );
            
            // 设置定时器，每10秒更新一次数据
            chartUpdateTimer = setInterval( updateChartData, 10000 );
            
            // 调整图表大小
            setTimeout( function() {
                if ( spaceChart ) {
                    spaceChart.resize();
                }
            }, 100 );
            
        } else {
            chartDiv.innerHTML = '<div style="color: #7a9fb8; text-align: center; padding: 50px;">未获取到数据</div>';
        }
        
    } catch ( error ) {
        console.error( '加载空间数据失败:', error );
        chartDiv.innerHTML = '<div style="color: #ff6b9d; background: rgba(255, 107, 157, 0.1); padding: 20px; border-radius: 6px; border-left: 3px solid #ff6b9d;">加载数据时出错: ' + error.message + '</div>';
    }
}

function hideSpaceChart() {
    const chartPanel = document.getElementById( 'space-chart-panel' );
    if ( chartPanel ) {
        chartPanel.style.display = 'none';
        // 恢复图表区域高度为0（flex布局会自动处理）
    }
    
    // 清除数据更新定时器
    if ( chartUpdateTimer ) {
        clearInterval( chartUpdateTimer );
        chartUpdateTimer = null;
    }
    
    // 移除resize监听器
    if ( chartResizeHandler ) {
        window.removeEventListener( 'resize', chartResizeHandler );
        chartResizeHandler = null;
    }
    
    // 销毁图表实例
    if ( spaceChart ) {
        spaceChart.dispose();
        spaceChart = null;
    }
}

function animate() {
    requestAnimationFrame( animate );
    // 更新控制器（如果启用了阻尼）
    controls.update();
    renderer.render( scene, camera );
}

init();

// ========== YOLOv8 检测功能 ==========

// 加载YOLOv8模型
async function loadYOLOModel() {
    const statusDiv = document.getElementById('detect-status');
    if (!statusDiv) return;
    
    try {
        statusDiv.textContent = '正在加载模型...';
        statusDiv.style.color = '#7a9fb8';
        
        // 检查ONNX Runtime是否已加载
        if (typeof ort === 'undefined') {
            throw new Error('ONNX Runtime 库未加载');
        }
        
        const modelPath = 'yolov8n.onnx';
        statusDiv.textContent = `正在下载模型...`;
        
        // 使用 fetch 先下载模型文件
        const response = await fetch(modelPath);
        if (!response.ok) {
            throw new Error(`HTTP错误! 状态: ${response.status}。请确保模型文件存在且可以通过HTTP访问。`);
        }
        
        statusDiv.textContent = `正在解析模型...`;
        const arrayBuffer = await response.arrayBuffer();
        
        statusDiv.textContent = `正在初始化ONNX Runtime...`;
        // 使用 ArrayBuffer 创建会话
        yoloSession = await ort.InferenceSession.create(arrayBuffer, {
            executionProviders: ['wasm'], // 使用 WebAssembly 后端
            graphOptimizationLevel: 'all', // 启用图优化
        });
        
        yoloModelLoaded = true;
        statusDiv.textContent = '模型已加载';
        statusDiv.style.color = '#4fc3f7';
        
        // 启用检测按钮
        const detectBtn = document.getElementById('detect-toggle-btn');
        if (detectBtn) {
            detectBtn.disabled = false;
        }
        
        console.log('YOLOv8模型加载成功');
        console.log('模型输入:', yoloSession.inputNames);
        console.log('模型输出:', yoloSession.outputNames);
    } catch (error) {
        console.error('YOLOv8模型加载失败:', error);
        let errorMsg = '模型加载失败';
        
        if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            errorMsg = '请确保通过HTTP服务器运行';
        } else if (error.message.includes('404')) {
            errorMsg = '找不到模型文件 yolov8n.onnx';
        } else {
            errorMsg = error.message;
        }
        
        if (statusDiv) {
            statusDiv.textContent = errorMsg;
            statusDiv.style.color = '#ff6b9d';
        }
    }
}

// 预处理视频帧（也支持图片）
function preprocessVideo(video) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    canvas.width = IMAGE_SIZE;
    canvas.height = IMAGE_SIZE;
    
    // 获取视频/图片的实际尺寸
    // 对于 video 元素，使用 videoWidth/videoHeight
    // 对于 img 元素，使用 width/height
    const sourceWidth = video.videoWidth || video.width || video.naturalWidth || IMAGE_SIZE;
    const sourceHeight = video.videoHeight || video.height || video.naturalHeight || IMAGE_SIZE;
    
    // 计算缩放比例，保持宽高比
    const scale = Math.min(IMAGE_SIZE / sourceWidth, IMAGE_SIZE / sourceHeight);
    const scaledWidth = sourceWidth * scale;
    const scaledHeight = sourceHeight * scale;
    const xOffset = (IMAGE_SIZE - scaledWidth) / 2;
    const yOffset = (IMAGE_SIZE - scaledHeight) / 2;
    
    // 绘制视频帧/图片（居中，填充黑色）
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, IMAGE_SIZE, IMAGE_SIZE);
    ctx.drawImage(video, xOffset, yOffset, scaledWidth, scaledHeight);
    
    // 获取图像数据并归一化
    const imageData = ctx.getImageData(0, 0, IMAGE_SIZE, IMAGE_SIZE);
    const data = imageData.data;
    
    // 转换为 RGB 格式并归一化到 [0, 1]
    const input = new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE);
    for (let i = 0; i < IMAGE_SIZE * IMAGE_SIZE; i++) {
        input[i] = data[i * 4] / 255.0;                     // R
        input[i + IMAGE_SIZE * IMAGE_SIZE] = data[i * 4 + 1] / 255.0;     // G
        input[i + 2 * IMAGE_SIZE * IMAGE_SIZE] = data[i * 4 + 2] / 255.0; // B
    }
    
    return {
        tensor: new ort.Tensor('float32', input, [1, 3, IMAGE_SIZE, IMAGE_SIZE]),
        scale: scale,
        xOffset: xOffset,
        yOffset: yOffset
    };
}

// NMS (Non-Maximum Suppression)
function nms(boxes, scores, iouThreshold = 0.3) {
    const indices = [];
    let sortedIndices = scores.map((score, index) => ({ score, index }))
        .sort((a, b) => b.score - a.score)
        .map(item => item.index);
    
    while (sortedIndices.length > 0) {
        const current = sortedIndices.shift();
        indices.push(current);
        
        const currentBox = boxes[current];
        sortedIndices = sortedIndices.filter(index => {
            const box = boxes[index];
            const iou = calculateIoU(currentBox, box);
            return iou < iouThreshold;
        });
    }
    
    return indices;
}

// 计算 IoU (Intersection over Union)
function calculateIoU(box1, box2) {
    const x1 = Math.max(box1.x1, box2.x1);
    const y1 = Math.max(box1.y1, box2.y1);
    const x2 = Math.min(box1.x2, box2.x2);
    const y2 = Math.min(box1.y2, box2.y2);
    
    if (x2 < x1 || y2 < y1) return 0;
    
    const intersection = (x2 - x1) * (y2 - y1);
    const area1 = (box1.x2 - box1.x1) * (box1.y2 - box1.y1);
    const area2 = (box2.x2 - box2.x1) * (box2.y2 - box2.y1);
    const union = area1 + area2 - intersection;
    
    return intersection / union;
}

// Sigmoid 函数
function sigmoid(x) {
    return 1 / (1 + Math.exp(-x));
}

// 后处理检测结果（根据参考代码重写）
function postprocess(output, originalWidth, originalHeight, scale, xOffset, yOffset, confThreshold = 0.5) {
    const outputData = output.data;
    const outputDims = output.dims;
    
    console.log('输出维度:', outputDims);
    console.log('输出数据长度:', outputData.length);
    
    // YOLOv8输出格式：扁平数组，8400个检测框
    // output[index] 是第index个检测框的中心点x（相对于640）
    // output[8400+index] 是第index个检测框的中心点y（相对于640）
    // output[2*8400+index] 是第index个检测框的宽度w（相对于640）
    // output[3*8400+index] 是第index个检测框的高度h（相对于640）
    // output[8400*(col+4)+index] 是第index个检测框的类别col的分数（col从0到79）
    
    const numBoxes = 8400;
    const numClasses = 80;
    let detections = [];
    
    // 遍历所有检测框
    for (let index = 0; index < numBoxes; index++) {
        // 找到置信度最高的类别
        let maxProb = 0;
        let classId = 0;
        
        for (let col = 0; col < numClasses; col++) {
            const prob = outputData[8400 * (col + 4) + index];
            if (prob > maxProb) {
                maxProb = prob;
                classId = col;
            }
        }
        
        // 过滤低置信度检测
        if (maxProb < confThreshold) continue;
        
        // 提取边界框坐标（相对于640x640）
        const xc = outputData[index];           // 中心点x
        const yc = outputData[8400 + index];     // 中心点y
        const w = outputData[2 * 8400 + index];  // 宽度
        const h = outputData[3 * 8400 + index];  // 高度
        
        // 转换到原始图像坐标（考虑letterbox填充）
        // 先转换到640x640输入图像的像素坐标
        const cxInput = xc;
        const cyInput = yc;
        const wInput = w;
        const hInput = h;
        
        // 转换到原始图像坐标
        let cxOriginal = (cxInput - xOffset) / scale;
        let cyOriginal = (cyInput - yOffset) / scale;
        let wOriginal = wInput / scale;
        let hOriginal = hInput / scale;
        
        // 计算边界框的左上角和右下角坐标
        let x1 = (cxOriginal - wOriginal / 2);
        let y1 = (cyOriginal - hOriginal / 2);
        let x2 = (cxOriginal + wOriginal / 2);
        let y2 = (cyOriginal + hOriginal / 2);
        
        // 限制在图像范围内
        x1 = Math.max(0, Math.min(originalWidth, x1));
        y1 = Math.max(0, Math.min(originalHeight, y1));
        x2 = Math.max(0, Math.min(originalWidth, x2));
        y2 = Math.max(0, Math.min(originalHeight, y2));
        
        // 过滤无效的边界框
        if (x2 <= x1 || y2 <= y1 || wOriginal <= 0 || hOriginal <= 0) continue;
        
        detections.push({
            x1: x1,
            y1: y1,
            x2: x2,
            y2: y2,
            confidence: maxProb,
            classId: classId,
            className: CLASS_NAMES[classId] || `class_${classId}`
        });
    }
    
    console.log(`处理了 ${numBoxes} 个检测框，过滤后剩余 ${detections.length} 个`);
    
    // 按置信度排序
    detections.sort((a, b) => b.confidence - a.confidence);
    
    // 应用 NMS (Non-Maximum Suppression) - 参考代码使用IoU阈值0.7
    const result = [];
    while (detections.length > 0) {
        const current = detections.shift(); // 取出置信度最高的
        result.push(current);
        
        // 过滤掉与当前框IoU > 0.7的其他框
        detections = detections.filter(box => {
            const iou = calculateIoU(
                { x1: current.x1, y1: current.y1, x2: current.x2, y2: current.y2 },
                { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 }
            );
            return iou < 0.7;
        });
    }
    
    console.log(`NMS后剩余 ${result.length} 个检测框`);
    return result;
}

// 绘制检测结果到canvas
function drawDetections(video, canvas, detections) {
    if (!video || !canvas) return;
    
    const ctx = canvas.getContext('2d');
    const videoWidth = video.videoWidth;
    const videoHeight = video.videoHeight;
    
    // 获取容器的实际显示尺寸
    const container = video.parentElement;
    if (!container) return;
    
    const containerRect = container.getBoundingClientRect();
    const displayWidth = containerRect.width;
    const displayHeight = containerRect.height;
    
    // 设置canvas尺寸与容器显示尺寸一致
    canvas.width = displayWidth;
    canvas.height = displayHeight;
    
    // 计算缩放比例（考虑object-fit: cover的效果）
    const videoAspect = videoWidth / videoHeight;
    const containerAspect = displayWidth / displayHeight;
    
    let scaleX, scaleY, offsetX = 0, offsetY = 0;
    
    if (videoAspect > containerAspect) {
        // 视频更宽，高度填满
        scaleY = displayHeight / videoHeight;
        scaleX = scaleY;
        const scaledWidth = videoWidth * scaleX;
        offsetX = (displayWidth - scaledWidth) / 2;
    } else {
        // 视频更高，宽度填满
        scaleX = displayWidth / videoWidth;
        scaleY = scaleX;
        const scaledHeight = videoHeight * scaleY;
        offsetY = (displayHeight - scaledHeight) / 2;
    }
    
    // 清除之前的绘制
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // 绘制检测框
    const colors = [
        '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
        '#FFA500', '#800080', '#FFC0CB', '#A52A2A'
    ];
    
    detections.forEach((det) => {
        const x1 = det.x1 * scaleX + offsetX;
        const y1 = det.y1 * scaleY + offsetY;
        const x2 = det.x2 * scaleX + offsetX;
        const y2 = det.y2 * scaleY + offsetY;
        const color = colors[det.classId % colors.length];
        
        // 绘制边界框
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        
        // 绘制标签背景
        const label = `${det.className} ${(det.confidence * 100).toFixed(1)}%`;
        ctx.font = '12px Arial';
        const textMetrics = ctx.measureText(label);
        const textWidth = textMetrics.width;
        const textHeight = 16;
        
        ctx.fillStyle = color;
        ctx.fillRect(x1, Math.max(0, y1 - textHeight), textWidth + 8, textHeight);
        
        // 绘制标签文字
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(label, x1 + 4, Math.max(textHeight - 4, y1 - 4));
    });
}

// 实时检测函数
async function detectFrame() {
    if (!isDetecting || !yoloModelLoaded || !yoloSession || !cameraStream) {
        return;
    }
    
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) {
        detectionAnimationFrame = requestAnimationFrame(detectFrame);
        return;
    }
    
    // 控制检测频率
    const now = Date.now();
    if (now - lastDetectionTime < DETECTION_INTERVAL) {
        detectionAnimationFrame = requestAnimationFrame(detectFrame);
        return;
    }
    
    // 防止重复处理
    if (isProcessingFrame) {
        detectionAnimationFrame = requestAnimationFrame(detectFrame);
        return;
    }
    
    isProcessingFrame = true;
    lastDetectionTime = now;
    
    try {
        // 预处理视频帧
        const { tensor, scale, xOffset, yOffset } = preprocessVideo(video);
        
        // 运行推理
        const feeds = {};
        const inputName = yoloSession.inputNames[0];
        feeds[inputName] = tensor;
        
        const output = await yoloSession.run(feeds);
        const outputTensor = output[yoloSession.outputNames[0]];
        
        // 后处理
        const detections = postprocess(
            outputTensor,
            video.videoWidth,
            video.videoHeight,
            scale,
            xOffset,
            yOffset
        );
        
        // 绘制检测结果
        drawDetections(video, canvas, detections);
        
        // 更新状态显示检测到的对象数量
        const statusDiv = document.getElementById('detect-status');
        if (statusDiv && detections.length > 0) {
            statusDiv.textContent = `检测中... (${detections.length}个对象)`;
        }
        
        // 更新检测结果显示
        updateDetectionResults(detections);
        
    } catch (error) {
        console.error('检测失败:', error);
        const statusDiv = document.getElementById('detect-status');
        if (statusDiv) {
            statusDiv.textContent = '检测出错';
            statusDiv.style.color = '#ff6b9d';
        }
    } finally {
        isProcessingFrame = false;
    }
    
    // 继续下一帧检测
    detectionAnimationFrame = requestAnimationFrame(detectFrame);
}

// 更新检测结果显示
function updateDetectionResults(detections) {
    const resultsPanel = document.getElementById('detection-results');
    const resultsContent = document.getElementById('detection-results-content');
    
    if (!resultsPanel || !resultsContent) return;
    
    if (detections.length === 0) {
        resultsPanel.style.display = 'none';
        return;
    }
    
    // 统计各类别的数量
    const classCount = {};
    detections.forEach(det => {
        const className = det.className;
        if (classCount[className]) {
            classCount[className]++;
        } else {
            classCount[className] = 1;
        }
    });
    
    // 生成显示文本
    let html = '';
    const totalCount = detections.length;
    
    // 中文类别名称映射（常用类别）
    const classNameMap = {
        'person': '行人',
        'bicycle': '自行车',
        'car': '汽车',
        'motorcycle': '摩托车',
        'airplane': '飞机',
        'bus': '公交车',
        'train': '火车',
        'truck': '卡车',
        'boat': '船',
        'traffic light': '交通灯',
        'fire hydrant': '消防栓',
        'stop sign': '停止标志',
        'parking meter': '停车计时器',
        'bench': '长椅',
        'bird': '鸟',
        'cat': '猫',
        'dog': '狗',
        'horse': '马',
        'sheep': '羊',
        'cow': '牛',
        'chair': '椅子',
        'couch': '沙发',
        'potted plant': '盆栽',
        'bed': '床',
        'dining table': '餐桌',
        'toilet': '马桶',
        'tv': '电视',
        'laptop': '笔记本电脑',
        'mouse': '鼠标',
        'remote': '遥控器',
        'keyboard': '键盘',
        'cell phone': '手机',
        'microwave': '微波炉',
        'oven': '烤箱',
        'toaster': '烤面包机',
        'sink': '水槽',
        'refrigerator': '冰箱',
        'book': '书',
        'clock': '时钟',
        'vase': '花瓶',
        'scissors': '剪刀',
        'teddy bear': '泰迪熊',
        'hair drier': '吹风机',
        'toothbrush': '牙刷'
    };
    
    // 按数量排序
    const sortedClasses = Object.entries(classCount).sort((a, b) => b[1] - a[1]);
    
    // 生成结果文本
    if (totalCount === 1) {
        const className = sortedClasses[0][0];
        const chineseName = classNameMap[className] || className;
        html = `检测到 <span style="color: #4fc3f7; font-weight: 600;">1个${chineseName}</span>`;
    } else {
        html = `检测到 <span style="color: #4fc3f7; font-weight: 600;">${totalCount}个对象</span>：<br>`;
        sortedClasses.forEach(([className, count]) => {
            const chineseName = classNameMap[className] || className;
            html += `• ${chineseName}: <span style="color: #4fc3f7;">${count}</span><br>`;
        });
    }
    
    resultsContent.innerHTML = html;
    resultsPanel.style.display = 'block';
}

// 开始/停止检测
function toggleDetection() {
    const detectBtn = document.getElementById('detect-toggle-btn');
    const statusDiv = document.getElementById('detect-status');
    
    if (!yoloModelLoaded || !yoloSession) {
        if (statusDiv) {
            statusDiv.textContent = '模型未加载';
            statusDiv.style.color = '#ff6b9d';
        }
        return;
    }
    
    if (!cameraStream) {
        if (statusDiv) {
            statusDiv.textContent = '请先打开摄像头';
            statusDiv.style.color = '#ff6b9d';
        }
        return;
    }
    
    isDetecting = !isDetecting;
    
    if (isDetecting) {
        // 开始检测
        const canvas = document.getElementById('camera-canvas');
        if (canvas) {
            canvas.style.display = 'block';
        }
        // 清空之前的检测结果
        const resultsPanel = document.getElementById('detection-results');
        if (resultsPanel) {
            resultsPanel.style.display = 'none';
        }
        if (detectBtn) {
            detectBtn.textContent = '停止检测';
        }
        if (statusDiv) {
            statusDiv.textContent = '检测中...';
            statusDiv.style.color = '#4fc3f7';
        }
        detectFrame();
    } else {
        // 停止检测
        if (detectionAnimationFrame) {
            cancelAnimationFrame(detectionAnimationFrame);
            detectionAnimationFrame = null;
        }
        isProcessingFrame = false;
        lastDetectionTime = 0;
        const canvas = document.getElementById('camera-canvas');
        if (canvas) {
            canvas.style.display = 'none';
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        // 隐藏检测结果
        const resultsPanel = document.getElementById('detection-results');
        if (resultsPanel) {
            resultsPanel.style.display = 'none';
        }
        if (detectBtn) {
            detectBtn.textContent = '开始检测';
        }
        if (statusDiv) {
            statusDiv.textContent = '已停止';
            statusDiv.style.color = '#7a9fb8';
        }
    }
}

// 摄像头控制逻辑
document.addEventListener( 'DOMContentLoaded', () => {
    const cameraBtn = document.getElementById( 'camera-toggle-btn' );
    const videoEl = document.getElementById( 'camera-video' );
    const placeholderEl = document.getElementById( 'camera-placeholder' );
    const errorEl = document.getElementById( 'camera-error' );

    if ( !cameraBtn || !videoEl ) return;

    async function startCamera() {
        try {
            errorEl.style.display = 'none';
            // 如果已经在推流，直接返回
            if ( cameraStream ) return;

            const stream = await navigator.mediaDevices.getUserMedia( {
                video: {
                    facingMode: 'environment'
                },
                audio: false
            } );

            cameraStream = stream;
            videoEl.srcObject = stream;
            videoEl.style.display = 'block';
            if ( placeholderEl ) placeholderEl.style.display = 'none';
            cameraBtn.textContent = '关闭摄像头';
        } catch ( err ) {
            console.error( '打开摄像头失败:', err );
            if ( errorEl ) {
                errorEl.textContent = '打开摄像头失败：' + ( err.message || '请检查浏览器权限设置' );
                errorEl.style.display = 'block';
            }
        }
    }

    function stopCamera() {
        // 停止检测
        if (isDetecting) {
            toggleDetection();
        }
        
        if ( cameraStream ) {
            cameraStream.getTracks().forEach( track => track.stop() );
            cameraStream = null;
        }
        videoEl.srcObject = null;
        videoEl.style.display = 'none';
        
        const canvas = document.getElementById('camera-canvas');
        if (canvas) {
            canvas.style.display = 'none';
            const ctx = canvas.getContext('2d');
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
        
        if ( placeholderEl ) placeholderEl.style.display = 'flex';
        cameraBtn.textContent = '打开摄像头';
    }

    cameraBtn.addEventListener( 'click', () => {
        if ( cameraStream ) {
            stopCamera();
        } else {
            startCamera();
        }
    } );

    // 页面关闭时停止摄像头
    window.addEventListener( 'beforeunload', () => {
        stopCamera();
    } );
    
    // 检测按钮事件
    const detectBtn = document.getElementById('detect-toggle-btn');
    if (detectBtn) {
        detectBtn.addEventListener('click', toggleDetection);
    }
    
    // 等待ONNX Runtime加载后加载模型
    if (typeof ort !== 'undefined') {
        loadYOLOModel();
    } else {
        // 轮询检查库是否加载
        const checkInterval = setInterval(() => {
            if (typeof ort !== 'undefined') {
                clearInterval(checkInterval);
                loadYOLOModel();
            }
        }, 100);
        
        // 10秒超时
        setTimeout(() => {
            if (typeof ort === 'undefined') {
                clearInterval(checkInterval);
                const statusDiv = document.getElementById('detect-status');
                if (statusDiv) {
                    statusDiv.textContent = 'ONNX Runtime 库加载失败';
                    statusDiv.style.color = '#ff6b9d';
                }
            }
        }, 10000);
    }
} );

