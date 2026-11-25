import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { useT } from '../i18n'

/* A stylised, hand-built low-poly island for the hero.
   It is deliberately illustrative (a heart-shaped landmass, like Marinduque's
   nickname) and is NOT a map: no coordinates, distances or places are encoded. */

const toWorld = (point) => ({ x: point.x, z: -point.y })

function heartPoint(t) {
  const x = 16 * Math.pow(Math.sin(t), 3)
  const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)
  return { x: x * 0.3, y: y * 0.3 }
}

function makeIslandGeometry() {
  const segments = 128
  const outline = []
  for (let i = 0; i < segments; i += 1) {
    const t = (i / segments) * Math.PI * 2
    const p = heartPoint(t)
    const wobble = 1 + 0.035 * Math.sin(3 * t + 0.6) + 0.022 * Math.cos(5 * t - 1.1)
    outline.push(new THREE.Vector2(p.x * wobble, p.y * wobble))
  }
  const shape = new THREE.Shape(outline)
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.95,
    bevelEnabled: true,
    bevelThickness: 0.18,
    bevelSize: 0.18,
    bevelSegments: 2,
    curveSegments: 2,
    steps: 1,
  })
  geometry.rotateX(-Math.PI / 2)
  geometry.computeBoundingBox()
  // Put the top face at y = 0 so the village, trees and beacons sit on land.
  geometry.translate(0, -geometry.boundingBox.max.y, 0)
  geometry.computeVertexNormals()
  return geometry
}

function rng(seed) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296
    return state / 4294967296
  }
}

export default function Island3D({ className = '', interactive = true, detail = true }) {
  const t = useT()
  const hostRef = useRef(null)
  const [failed, setFailed] = useState(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return undefined

    let renderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    } catch {
      setFailed(true)
      return undefined
    }

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x08201c, 0.032)

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120)
    camera.position.set(0, 11.6, 10.4)
    camera.lookAt(0, 0.1, 0)

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setClearAlpha(0)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.06
    host.appendChild(renderer.domElement)

    const world = new THREE.Group()
    world.rotation.set(0.05, 0, 0)
    scene.add(world)

    /* ------------------------------- Lighting ------------------------------ */
    scene.add(new THREE.HemisphereLight(0xd8f2e6, 0x06120f, 1.35))
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.6)
    sun.position.set(7, 11, 6)
    scene.add(sun)
    const fill = new THREE.DirectionalLight(0x74c7c0, 0.9)
    fill.position.set(-8, 4, -6)
    scene.add(fill)

    /* -------------------------------- Island ------------------------------- */
    const islandGeometry = makeIslandGeometry()
    const islandTop = new THREE.MeshStandardMaterial({ color: 0x2f6f52, roughness: 0.92, metalness: 0 })
    const islandSide = new THREE.MeshStandardMaterial({ color: 0x8f7a52, roughness: 1, metalness: 0 })
    const island = new THREE.Mesh(islandGeometry, [islandTop, islandSide])
    world.add(island)

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(islandGeometry, 26),
      new THREE.LineBasicMaterial({ color: 0xa9e3c8, transparent: true, opacity: 0.22 }),
    )
    island.add(outline)

    const random = rng(20261121)
    const scatter = []
    const treeTrunk = new THREE.MeshStandardMaterial({ color: 0x6b4b33, roughness: 1 })
    const treeLeaf = new THREE.MeshStandardMaterial({ color: 0x4f9c72, roughness: 0.95, flatShading: true })
    const treeLeafAlt = new THREE.MeshStandardMaterial({ color: 0x6ab586, roughness: 0.95, flatShading: true })
    const hillMaterial = new THREE.MeshStandardMaterial({ color: 0x356b4d, roughness: 1, flatShading: true })
    const hillMaterialAlt = new THREE.MeshStandardMaterial({ color: 0x2a5b46, roughness: 1, flatShading: true })
    const houseMaterial = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.85 })
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0xa9563a, roughness: 0.9 })

    const hillCount = detail ? 11 : 6
    for (let i = 0; i < hillCount; i += 1) {
      const t = random() * Math.PI * 2
      const p = heartPoint(t)
      const spread = 0.16 + random() * 0.42
      const radius = 0.42 + random() * 0.72
      const height = radius * (1.1 + random() * 1.25)
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(radius, height, 5 + Math.floor(random() * 3), 1),
        random() > 0.45 ? hillMaterial : hillMaterialAlt,
      )
      hill.position.set(p.x * spread, height / 2, -p.y * spread)
      hill.rotation.y = random() * Math.PI
      world.add(hill)
      scatter.push(hill)
    }

    const treeCount = detail ? 30 : 14
    for (let i = 0; i < treeCount; i += 1) {
      const t = random() * Math.PI * 2
      const p = heartPoint(t)
      const spread = 0.45 + random() * 0.5
      const x = p.x * spread
      const z = -p.y * spread
      const scale = 0.55 + random() * 0.5
      const tree = new THREE.Group()
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 5), treeTrunk)
      trunk.position.y = 0.15
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.27, 0), random() > 0.5 ? treeLeaf : treeLeafAlt)
      crown.position.y = 0.62
      crown.scale.set(1, 0.85, 1)
      const crown2 = new THREE.Mesh(new THREE.IcosahedronGeometry(0.19, 0), treeLeafAlt)
      crown2.position.set(0.12, 0.82, -0.06)
      tree.add(trunk, crown, crown2)
      tree.scale.setScalar(scale)
      tree.position.set(x, 0, z)
      tree.rotation.y = random() * Math.PI
      world.add(tree)
      scatter.push(tree)
    }

    const clusterCount = detail ? 7 : 4
    for (let i = 0; i < clusterCount; i += 1) {
      const t = (i / clusterCount) * Math.PI * 2 + 0.35
      const p = heartPoint(t)
      const spread = 0.5 + random() * 0.16
      const cluster = new THREE.Group()
      const houses = 2 + Math.floor(random() * 3)
      for (let h = 0; h < houses; h += 1) {
        const width = 0.1 + random() * 0.06
        const body = new THREE.Mesh(new THREE.BoxGeometry(width, width * 0.8, width), houseMaterial)
        body.position.set((random() - 0.5) * 0.26, width * 0.4, (random() - 0.5) * 0.26)
        const roof = new THREE.Mesh(new THREE.ConeGeometry(width * 0.86, width * 0.6, 4), roofMaterial)
        roof.position.copy(body.position)
        roof.position.y += width * 0.8
        roof.rotation.y = Math.PI / 4
        cluster.add(body, roof)
      }
      cluster.position.set(p.x * spread, 0.02, -p.y * spread)
      world.add(cluster)
      scatter.push(cluster)
    }

    /* Six small beacons - one for each municipality, purely symbolic. */
    const markers = []
    const beaconMaterial = new THREE.MeshStandardMaterial({
      color: 0xffd8a0,
      emissive: 0xffb45f,
      emissiveIntensity: 1.5,
      roughness: 0.4,
    })
    for (let i = 0; i < 6; i += 1) {
      const t = (i / 6) * Math.PI * 2 + 0.5
      const p = heartPoint(t)
      const group = new THREE.Group()
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 12), beaconMaterial)
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.016, 6, 32),
        new THREE.MeshBasicMaterial({ color: 0xffd8a0, transparent: true, opacity: 0.55 }),
      )
      ring.rotation.x = -Math.PI / 2
      group.add(dot, ring)
      group.position.set(p.x * 0.66, 0.3, -p.y * 0.66)
      world.add(group)
      markers.push({ group, ring })
    }

    /* -------------------------------- Water -------------------------------- */
    const waterGeometry = new THREE.PlaneGeometry(120, 120, 64, 64)
    waterGeometry.rotateX(-Math.PI / 2)
    const waterBase = waterGeometry.attributes.position.array.slice()
    const water = new THREE.Mesh(
      waterGeometry,
      new THREE.MeshStandardMaterial({
        color: 0x0c3b38,
        roughness: 0.32,
        metalness: 0.42,
        transparent: true,
        opacity: 0.94,
      }),
    )
    water.position.y = -0.32
    scene.add(water)

    const halo = new THREE.Mesh(
      new THREE.RingGeometry(5.4, 6.1, 64),
      new THREE.MeshBasicMaterial({ color: 0x8fd9c6, transparent: true, opacity: 0.08, side: THREE.DoubleSide }),
    )
    halo.rotation.x = -Math.PI / 2
    halo.position.y = -0.3
    scene.add(halo)

    /* Compass ticks */
    const ticks = new THREE.Group()
    for (let i = 0; i < 48; i += 1) {
      const angle = (i / 48) * Math.PI * 2
      const tick = new THREE.Mesh(
        new THREE.BoxGeometry(0.012, 0.012, i % 4 === 0 ? 0.28 : 0.14),
        new THREE.MeshBasicMaterial({ color: 0x9fd8c7, transparent: true, opacity: i % 4 === 0 ? 0.42 : 0.2 }),
      )
      tick.position.set(Math.sin(angle) * 8.1, -0.26, Math.cos(angle) * 8.1)
      tick.rotation.y = angle
      ticks.add(tick)
    }
    scene.add(ticks)

    /* ------------------------------ Interaction ---------------------------- */
    let targetY = world.rotation.y
    let targetX = world.rotation.x
    let autoSpin = 1
    let draggingNow = false
    let lastX = 0
    let lastY = 0

    const onPointerDown = (event) => {
      if (!interactive) return
      draggingNow = true
      setDragging(true)
      lastX = event.clientX
      lastY = event.clientY
      host.setPointerCapture?.(event.pointerId)
    }
    const onPointerMove = (event) => {
      if (!draggingNow) return
      const dx = event.clientX - lastX
      const dy = event.clientY - lastY
      lastX = event.clientX
      lastY = event.clientY
      targetY += dx * 0.006
      targetX = Math.max(-0.35, Math.min(0.55, targetX + dy * 0.0035))
      autoSpin = 0
      draw()
    }
    const onPointerUp = () => {
      draggingNow = false
      setDragging(false)
      window.setTimeout(() => {
        autoSpin = 1
      }, 2400)
    }

    if (interactive) {
      host.addEventListener('pointerdown', onPointerDown)
      window.addEventListener('pointermove', onPointerMove)
      window.addEventListener('pointerup', onPointerUp)
      window.addEventListener('pointercancel', onPointerUp)
    }

    /* -------------------------------- Resize ------------------------------- */
    const draw = () => {
      renderer.render(scene, camera)
    }

    const resize = () => {
      const width = host.clientWidth || 1
      const height = host.clientHeight || 1
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      // Pull the camera back on tall/narrow screens so the island still fits.
      camera.position.z = width < height * 0.95 ? 13.4 : 10.4
      camera.position.y = width < height * 0.95 ? 13.6 : 11.6
      camera.updateProjectionMatrix()
      draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(host)
    resize()

    /* --------------------------------- Loop -------------------------------- */
    let raf = 0
    let visible = true
    const clock = new THREE.Clock()

    const frame = () => {
      raf = 0
      const time = clock.getElapsedTime()
      if (!reduced.matches) {
        targetY += 0.0016 * autoSpin
        world.rotation.y += (targetY - world.rotation.y) * 0.06
        world.rotation.x += (targetX - world.rotation.x) * 0.06
        world.position.y = Math.sin(time * 0.55) * 0.055
        water.rotation.y = Math.sin(time * 0.08) * 0.05
        ticks.rotation.y = time * 0.035
        const position = water.geometry.attributes.position
        for (let i = 0; i < position.count; i += 1) {
          const baseX = waterBase[i * 3]
          const baseZ = waterBase[i * 3 + 2]
          position.array[i * 3 + 1] =
            Math.sin(baseX * 0.55 + time * 0.9) * 0.07 + Math.cos(baseZ * 0.42 + time * 0.65) * 0.06
        }
        position.needsUpdate = true
        markers.forEach((marker, index) => {
          const pulse = 1 + Math.sin(time * 1.6 + index) * 0.16
          marker.ring.scale.setScalar(pulse)
          marker.ring.material.opacity = 0.55 - Math.sin(time * 1.6 + index) * 0.22
          marker.group.position.y = 0.3 + Math.sin(time * 1.2 + index * 0.9) * 0.04
        })
      }
      draw()
      if (visible && !reduced.matches) raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (!raf) raf = requestAnimationFrame(frame)
    }

    const intersection = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true
        if (visible) start()
      },
      { threshold: 0.05 },
    )
    intersection.observe(host)

    if (reduced.matches) {
      draw()
      reduced.addEventListener('change', start)
    } else {
      start()
    }

    /* -------------------------------- Cleanup ------------------------------ */
    return () => {
      if (raf) cancelAnimationFrame(raf)
      intersection.disconnect()
      observer.disconnect()
      reduced.removeEventListener('change', start)
      if (interactive) {
        host.removeEventListener('pointerdown', onPointerDown)
        window.removeEventListener('pointermove', onPointerMove)
        window.removeEventListener('pointerup', onPointerUp)
        window.removeEventListener('pointercancel', onPointerUp)
      }
      scene.traverse((object) => {
        if (object.geometry) object.geometry.dispose()
        const material = object.material
        if (Array.isArray(material)) material.forEach((entry) => entry.dispose())
        else if (material) material.dispose()
      })
      renderer.dispose()
      if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement)
    }
  }, [interactive, detail])

  return (
    <div
      ref={hostRef}
      className={`scene-shell ${dragging ? 'is-dragging' : ''} ${className}`.trim()}
      role="img"
      aria-label={t('scene.aria', 'Stylised three-dimensional illustration of a heart-shaped island province, surrounded by water, with six small beacons representing the municipalities. Decorative only — not a map to scale.')}
    >
      {failed ? (
        <div className="scene-fallback">
          <p>{t('scene.failed', 'Your browser could not start the 3D illustration. All information below is unaffected.')}</p>
        </div>
      ) : null}
      <span className="scene-hint">{t('scene.drag', 'Drag to explore')}</span>
      <span className="scene-legend">
        <span>Marinduque</span>
        <span>{t('scene.scale', 'Stylised · not to scale')}</span>
      </span>
    </div>
  )
}
