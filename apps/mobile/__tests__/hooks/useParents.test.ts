jest.mock("@/lib/web-api", () => ({
  fetchWithAuth: jest.fn(),
}));

jest.mock("@/lib/parents", () => ({
  buildParentPayload: jest.fn(),
}));

import { fetchParentsDirectory } from "@/hooks/useParents";

type ParentRecord = {
  id: string;
  first_name: string;
  last_name: string;
  user_id?: string | null;
};

function makeParent(id: number): ParentRecord {
  return {
    id: `parent-${id}`,
    first_name: `First ${id}`,
    last_name: `Last ${id}`,
    user_id: `user-${id}`,
  };
}

describe("useParents", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("fetches every parents page when the API reports more than 200 records", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => makeParent(index + 1));
    const secondPage = Array.from({ length: 50 }, (_, index) => makeParent(index + 201));
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ parents: firstPage, total: 250, limit: 200, offset: 0 })
      .mockResolvedValueOnce({ parents: secondPage, total: 250, limit: 200, offset: 200 });

    const parents = await fetchParentsDirectory(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(fetchPage).toHaveBeenNthCalledWith(1, 0, 200);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 200, 200);
    expect(parents).toHaveLength(250);
    expect(parents?.[0]?.id).toBe("parent-1");
    expect(parents?.[249]?.id).toBe("parent-250");
  });

  it("stops paging when a page is shorter than the limit and total is missing", async () => {
    const firstPage = Array.from({ length: 200 }, (_, index) => makeParent(index + 1));
    const secondPage = Array.from({ length: 10 }, (_, index) => makeParent(index + 201));
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ parents: firstPage, limit: 200, offset: 0 })
      .mockResolvedValueOnce({ parents: secondPage, limit: 200, offset: 200 });

    const parents = await fetchParentsDirectory(fetchPage);

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(parents).toHaveLength(210);
  });

  it("returns null when the request is invalidated mid-pagination", async () => {
    let requestIsCurrent = true;
    const firstPage = Array.from({ length: 200 }, (_, index) => makeParent(index + 1));
    const fetchPage = jest.fn(async (offset: number) => {
      if (offset === 0) {
        requestIsCurrent = false;
        return { parents: firstPage, total: 250, limit: 200, offset: 0 };
      }

      return { parents: [makeParent(201)], total: 250, limit: 200, offset };
    });

    const parents = await fetchParentsDirectory(fetchPage, {
      isCurrentRequest: () => requestIsCurrent,
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(parents).toBeNull();
  });
});
