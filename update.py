#!/usr/bin/python3
# -*- coding: utf-8 -*-

import markdown
import os

index_template = "./templates/index_template.html"
post_template = "./templates/post_template.html"

def get_title(md):
    """ get the title of the post.

    Assume the tilte of the post is started with ##:

    first find '##'
    then segment the title for the first line 
    """
    start_index = md.find("##")
    end_index = 2 + md[start_index+2:].find("\n")
    sub = md[start_index+2:end_index+1]
    return sub.strip()

def update():
    """ update all poses, by reading all .md posts

    list all md file names, sorted. 
    generate html pages with the same names
    
    """
    global post_template
    global index_template
    
    all_files = os.listdir("./posts/")
    md_files = [f for f in all_files if f.endswith(".md")]
    md_files.sort()

    post_template = open(post_template).read()

    names_and_titles = []
    for f in md_files:
        md = open("./posts/"+f).read()
        if md is None or len(md) == 0:
            continue
        html = markdown.markdown(md)
        p = post_template.format(html)
        html_name = f[:-2]+"html"
        post_title = get_title(md)
        open("./html/"+ html_name, "w").write(p)
        names_and_titles.append((html_name, post_title))

    # need to update index
    index_template = open(index_template).read()
    item = '''<a href="./html/{0}">{1}</a>'''
    items = []
    for nt in names_and_titles:
        items.append(item.format(nt[0], nt[1]))

    # the latest posts first.
    items.reverse()
    open("index.html", "w").write(index_template.format(" ".join(items)))        
    print("updated: \n" + "\n".join(items))
    
if __name__ == '__main__':    
    update()
