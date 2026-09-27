import { useLocation, useNavigate } from "react-router-dom";
import { useTabs } from "../context/TabsContext";
import Icon from "./ui/Icon";

export default function TabBar() {
  const { tabs, closeTab } = useTabs();
  const location = useLocation();
  const navigate = useNavigate();

  if (tabs.length === 0) return null;

  const currentPath = location.pathname + location.search;

  return (
    <div className="global-tab-bar">
      {tabs.map((tab) => {
        const active = tab.path === currentPath;
        return (
          <div
            key={tab.id}
            className={`gtab${active ? " gtab-active" : ""}`}
            onClick={() => navigate(tab.path)}
            title={tab.label}
          >
            <Icon name={tab.icon} style={{ fontSize: 14 }} />
            <span className="gtab-label">{tab.label}</span>
            <button
              className="gtab-close"
              aria-label="Fechar aba"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
                if (active && tabs.length > 1) {
                  const idx = tabs.findIndex((t) => t.id === tab.id);
                  const next = tabs[idx - 1] || tabs[idx + 1];
                  if (next) navigate(next.path);
                }
              }}
            >
              <Icon name="close" style={{ fontSize: 12 }} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
