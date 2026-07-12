# Layout Patterns

## VBox Layout (Fullscreen Panels)

Use this pattern when you want header → content → footer stacked vertically with zero gaps.

### CSS Pattern

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

html, body {
  height: 100%;
  overflow: hidden;
}

body {
  display: flex;
  flex-direction: column;
}

/* Header - fixed height */
nav {
  flex-shrink: 0;
  height: 60px;
}

/* Main content - fills remaining space */
main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Panels container */
.panels {
  display: flex;
  flex: 1;
  width: 100%;
}

/* Individual panels */
.panel {
  flex: 1;
  height: 100%;
}

/* Footer - fixed height */
footer {
  flex-shrink: 0;
  height: 52px;
}
```

### HTML Structure

```html
<body>
  <nav>Header (60px)</nav>
  <main>
    <section class="panels">
      <div class="panel">Panel 1</div>
      <div class="panel">Panel 2</div>
    </section>
  </main>
  <footer>Footer (52px)</footer>
</body>
```

### Key Points
- No `position: fixed` needed (except maybe nav)
- Use `flex: 1` on main content area to fill space
- Use `flex-shrink: 0` on header/footer to prevent squishing
- All heights add up to 100vh (60px + remaining + 52px)

---

## Split Panels (2-Column)

For immersive 50/50 or 60/40 splits.

```css
.container {
  display: flex;
  height: 100vh;
  width: 100vw;
}

.panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

---

## Grid Panels (2x2)

For 4-panel grid layout.

```css
.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  grid-template-rows: 1fr 1fr;
  height: 100vh;
  width: 100vw;
}
```
