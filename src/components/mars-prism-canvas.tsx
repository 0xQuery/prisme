"use client";

import { useEffect, useRef, useState } from "react";

import { EngagementState } from "@/lib/types";

interface MarsPrismCanvasProps {
  engagementState: EngagementState;
  className?: string;
  onPerformanceFallback?: () => void;
}

function compileShader(
  gl: WebGLRenderingContext,
  shaderType: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(shaderType);
  if (!shader) {
    throw new Error("Failed to create shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const error = gl.getShaderInfoLog(shader) ?? "Unknown shader compile error.";
    gl.deleteShader(shader);
    throw new Error(error);
  }

  return shader;
}

function createProgram(gl: WebGLRenderingContext): WebGLProgram {
  const vertexSource = `
    attribute vec2 a_position;
    void main() {
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    precision highp float;
    uniform vec2 u_resolution;
    uniform float u_time;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);

      float a = hash(i);
      float b = hash(i + vec2(1.0, 0.0));
      float c = hash(i + vec2(0.0, 1.0));
      float d = hash(i + vec2(1.0, 1.0));

      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
    }

    float fbm(vec2 p) {
      float value = 0.0;
      float amplitude = 0.5;
      for (int i = 0; i < 6; i++) {
        value += amplitude * noise(p);
        p *= 2.05;
        amplitude *= 0.52;
      }
      return value;
    }

    void main() {
      vec2 uv = (gl_FragCoord.xy * 2.0 - u_resolution.xy) / min(u_resolution.x, u_resolution.y);
      float t = u_time * 0.07;

      float terrain = fbm(uv * 2.2 + vec2(t * 0.7, -t * 0.55));
      float ridge = abs(fbm(uv * 3.9 - vec2(t * 0.32, t * 0.25)) * 2.0 - 1.0);
      float prism = smoothstep(0.44, 0.92, fbm(uv * 6.1 + vec2(-t * 0.65, t * 0.41)));
      float dust = fbm(uv * 9.2 + vec2(t * 0.22, -t * 0.18));

      vec3 deep = vec3(0.08, 0.03, 0.05);
      vec3 rust = vec3(0.32, 0.08, 0.11);
      vec3 crimson = vec3(0.57, 0.13, 0.18);
      vec3 highlight = vec3(0.88, 0.36, 0.34);

      vec3 color = mix(deep, rust, smoothstep(0.16, 0.84, terrain));
      color = mix(color, crimson, ridge * 0.62);
      color += highlight * pow(prism, 4.0) * 0.33;
      color += vec3(0.06, 0.02, 0.03) * pow(dust, 2.3) * 0.23;

      float vignette = smoothstep(1.42, 0.2, length(uv));
      color *= vignette;

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create program.");
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const error = gl.getProgramInfoLog(program) ?? "Unknown link error.";
    gl.deleteProgram(program);
    throw new Error(error);
  }

  return program;
}

export function MarsPrismCanvas({
  engagementState,
  className,
  onPerformanceFallback,
}: MarsPrismCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<EngagementState>(engagementState);
  const [fallbackMode, setFallbackMode] = useState<"NONE" | "REDUCED_MOTION" | "WEBGL">("NONE");

  useEffect(() => {
    stateRef.current = engagementState;
  }, [engagementState]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      if (query.matches) {
        setFallbackMode("REDUCED_MOTION");
      }
    };

    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (fallbackMode !== "NONE") {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const gl = canvas.getContext("webgl", {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      setFallbackMode("WEBGL");
      onPerformanceFallback?.();
      return;
    }

    let animationId = 0;
    let isDisposed = false;
    let lastTime = performance.now();
    let elapsedTime = 0;
    let frozenTime = 0;
    let frameCount = 0;
    let slowFrameCount = 0;

    const program = createProgram(gl);
    const positionBuffer = gl.createBuffer();
    if (!positionBuffer) {
      setFallbackMode("WEBGL");
      onPerformanceFallback?.();
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );

    gl.useProgram(program);
    const positionLocation = gl.getAttribLocation(program, "a_position");
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const timeLocation = gl.getUniformLocation(program, "u_time");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * pixelRatio));
      canvas.height = Math.max(1, Math.floor(height * pixelRatio));
      gl.viewport(0, 0, canvas.width, canvas.height);
    };

    const renderFrame = (now: number) => {
      if (isDisposed) {
        return;
      }

      const delta = now - lastTime;
      lastTime = now;
      frameCount += 1;
      if (delta > 40) {
        slowFrameCount += 1;
      }

      if (frameCount > 120 && slowFrameCount / frameCount > 0.55) {
        setFallbackMode("WEBGL");
        onPerformanceFallback?.();
        return;
      }

      if (stateRef.current === "FROZEN") {
        elapsedTime = frozenTime;
      } else {
        elapsedTime += delta / 1000;
        frozenTime = elapsedTime;
      }

      gl.uniform2f(resolutionLocation, canvas.width, canvas.height);
      gl.uniform1f(timeLocation, elapsedTime);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      animationId = requestAnimationFrame(renderFrame);
    };

    resize();
    window.addEventListener("resize", resize);
    animationId = requestAnimationFrame(renderFrame);

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationId);
      window.removeEventListener("resize", resize);
      gl.deleteProgram(program);
      gl.deleteBuffer(positionBuffer);
    };
  }, [fallbackMode, onPerformanceFallback]);

  if (fallbackMode !== "NONE") {
    return <div className={`mars-fallback ${className ?? ""}`} aria-hidden />;
  }

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
