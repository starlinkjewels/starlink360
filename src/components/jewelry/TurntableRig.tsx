/*
 * `turntableControls.ts` as an R3F component.
 *
 * Split from the class for the same reason `tools.ts` is split from
 * `Canvas.tsx`: a module that exports both a component and something else
 * breaks fast refresh while either is being edited.
 *
 * Stands in for drei's `<OrbitControls makeDefault />`, and does the same
 * three things — build the controls against the default camera, drive
 * `update()` every frame, and publish the instance as `state.controls` so the
 * axis gizmo and anything else asking R3F for "the controls" finds it.
 */
import { forwardRef, useEffect, useImperativeHandle, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { TurntableControls as TurntableControlsImpl } from "./turntableControls";

export interface TurntableRigProps {
  enabled?: boolean;
  enableDamping?: boolean;
  dampingFactor?: number;
  rotateSpeed?: number;
  zoomSpeed?: number;
  makeDefault?: boolean;
}

export const TurntableRig = forwardRef<TurntableControlsImpl, TurntableRigProps>(
  function TurntableRig(
    {
      enabled = true,
      enableDamping = true,
      dampingFactor = 0.06,
      rotateSpeed = 0.85,
      zoomSpeed = 1,
      makeDefault = false,
    },
    ref,
  ) {
    const camera = useThree((s) => s.camera);
    const gl = useThree((s) => s.gl);
    const set = useThree((s) => s.set);
    const get = useThree((s) => s.get);
    const invalidate = useThree((s) => s.invalidate);

    /*
     * Rebuilt when the camera changes, because the projection swap replaces
     * the camera object outright — the same reason the cameras carry a `key`.
     */
    const controls = useMemo(
      () => new TurntableControlsImpl(camera, gl.domElement),
      [camera, gl.domElement],
    );

    /*
     * Claim on mount, give it back on unmount — see `driving` in
     * `turntableControls.ts`. Only a component React actually kept runs this,
     * which is what makes the claim trustworthy.
     */
    useEffect(() => {
      controls.claim();
      return () => {
        controls.release();
        controls.dispose();
      };
    }, [controls]);

    useEffect(() => {
      const onChange = () => invalidate();
      controls.addEventListener("change", onChange);
      return () => controls.removeEventListener("change", onChange);
    }, [controls, invalidate]);

    useEffect(() => {
      if (!makeDefault) return;
      const previous = get().controls;
      // The cast mirrors drei's own: R3F types `controls` as its EventDispatcher
      // shape, which this satisfies structurally for every consumer.
      set({ controls: controls as unknown as typeof previous });
      return () => set({ controls: previous });
    }, [controls, makeDefault, get, set]);

    controls.enabled = enabled;
    controls.enableDamping = enableDamping;
    controls.dampingFactor = dampingFactor;
    controls.rotateSpeed = rotateSpeed;
    controls.zoomSpeed = zoomSpeed;

    useFrame(() => controls.update(), -1);

    useImperativeHandle(ref, () => controls, [controls]);

    return null;
  },
);
