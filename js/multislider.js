// Multi-handle slider for the panel (Levels, Output Levels, Boost Shadow Amount).
// UXP's <sp-slider> has a single handle, so this draws its own track and handles.
//
// new MultiSlider(container, {
//   min, max,
//   handles: ["handle-black", "handle-mid", "handle-white"], // CSS class per handle
//   trackClass: "track-levels",
//   fill: [0, 2],                   // highlight between these handles, or "start" for min..handle 0
//   getValues: () => [..],          // current value of each handle, in track units
//   onDrag: (index, value) => {},   // a handle was dragged to `value`; update state
// })
// Call render() after changing values from outside (e.g. a number field).

(function (root) {
  "use strict";

  class MultiSlider {
    constructor(el, options) {
      this.opts = options;
      this.active = null;

      el.classList.add("ms");
      this.rail = document.createElement("div");
      this.rail.className = "ms-rail";
      el.appendChild(this.rail);

      const track = document.createElement("div");
      track.className = "ms-track " + (options.trackClass || "");
      this.rail.appendChild(track);

      if (options.fill) {
        this.fill = document.createElement("div");
        this.fill.className = "ms-fill";
        this.rail.appendChild(this.fill);
      }

      this.handles = options.handles.map((cls, index) => {
        const handle = document.createElement("div");
        handle.className = "ms-handle " + cls;
        handle.addEventListener("mousedown", (event) => this.start(event, index));
        this.rail.appendChild(handle);
        return handle;
      });

      // Clicking the track moves the nearest handle there.
      el.addEventListener("mousedown", (event) => {
        if (event.target.classList.contains("ms-handle")) return;
        const value = this.valueAt(event.clientX);
        this.start(event, this.nearest(value));
        this.move(event);
      });

      this.onMove = (event) => this.move(event);
      this.onUp = () => this.end();
      this.render();
    }

    valueAt(clientX) {
      const { min, max } = this.opts;
      const rect = this.rail.getBoundingClientRect();
      const t = rect.width ? (clientX - rect.left) / rect.width : 0;
      return min + Math.min(1, Math.max(0, t)) * (max - min);
    }

    // Nearest handle to a value; ties go to the later handle so stacked
    // handles at the left edge can still be pulled apart.
    nearest(value) {
      const values = this.opts.getValues();
      let best = 0;
      let bestDistance = Infinity;
      values.forEach((v, i) => {
        const d = Math.abs(v - value);
        if (d <= bestDistance) {
          bestDistance = d;
          best = i;
        }
      });
      return best;
    }

    start(event, index) {
      event.preventDefault();
      event.stopPropagation();
      this.active = index;
      this.handles[index].classList.add("dragging");
      document.addEventListener("mousemove", this.onMove);
      document.addEventListener("mouseup", this.onUp);
    }

    move(event) {
      if (this.active === null) return;
      this.opts.onDrag(this.active, this.valueAt(event.clientX));
      this.render();
    }

    end() {
      if (this.active !== null) this.handles[this.active].classList.remove("dragging");
      this.active = null;
      document.removeEventListener("mousemove", this.onMove);
      document.removeEventListener("mouseup", this.onUp);
    }

    render() {
      const { min, max } = this.opts;
      const values = this.opts.getValues();
      const pct = (value) => Math.min(1, Math.max(0, (value - min) / (max - min))) * 100;
      values.forEach((value, i) => {
        this.handles[i].style.left = `${pct(value)}%`;
      });
      if (this.fill) {
        const fill = this.opts.fill;
        const from = fill === "start" ? 0 : pct(values[fill[0]]);
        const to = fill === "start" ? pct(values[0]) : pct(values[fill[1]]);
        this.fill.style.left = `${from}%`;
        this.fill.style.width = `${Math.max(0, to - from)}%`;
      }
    }
  }

  root.MultiSlider = MultiSlider;
})(globalThis);
